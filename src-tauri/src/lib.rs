// CladeForge desktop shell.
//
// The frontend (React) does all tree editing, parsing and rendering. The Rust
// side deliberately keeps a *small, explicit* surface:
//   * the dialog plugin provides native open/save file pickers;
//   * a handful of `#[tauri::command]`s perform the actual file IO on a path the
//     user picked in the dialog.
//
// Routing IO through our own commands means the webview never needs the broad
// `fs:allow-**` capability (least privilege). It also establishes the JS <-> Rust
// boundary that heavier native work (simulation / inference) can grow into later —
// see `app_info` as the seed of that compute surface.
//
// Because a command name is callable by *any* script in the webview, "the user
// picked this path" is an assumption, not a guarantee: every path argument is
// therefore validated (`validate_path`) against an allow-list of roots, with
// traversal and symlink escape rejected, before a single byte is read or
// written.
//
// The allow-list is just the user's document folders and the per-user temp dir.
// `$HOME` is deliberately not on it: `$HOME` *is* `~/.ssh`, `~/.aws`, the keychain
// directories and every browser profile, and on macOS `/Volumes` also reaches the
// boot volume, so other users' homes too. Anything else is accepted only after a
// *person* chose it in a native dialog — recorded in the filesystem scope that the
// dialog plugin's own Rust side maintains, never by the webview — and that folder
// is then allowed for the rest of the run, so the flow the UI depends on (pick a
// path, then write to it) still works end to end.

use std::collections::BTreeSet;
use std::path::{Component, Path, PathBuf};
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Mutex, OnceLock, PoisonError};

use serde::Serialize;
use tauri_plugin_fs::FsExt;

#[derive(Serialize)]
struct AppInfo {
    name: String,
    version: String,
    tauri: String,
}

/// Largest file `read_text_file` will load into memory. Mirrors
/// `MAX_NATIVE_READ_BYTES` in `src/io/native.ts`; a tree file of that size is
/// already far past what the app can render, so hitting it means the user
/// picked a wrong file (a fasta, a zip) — better an error than an OOM.
const MAX_READ_BYTES: u64 = 256 * 1024 * 1024;

/// The home directory — or directories, since Windows may set both `HOME` and
/// `USERPROFILE` — canonicalised so a symlinked home cannot present two
/// different identities to the allow-list.
fn home_dirs() -> Vec<PathBuf> {
    let mut homes: BTreeSet<PathBuf> = BTreeSet::new();
    for key in ["HOME", "USERPROFILE"] {
        if let Ok(value) = std::env::var(key) {
            if !value.trim().is_empty() {
                if let Ok(canonical) = Path::new(&value).canonicalize() {
                    homes.insert(canonical);
                }
            }
        }
    }
    homes.into_iter().collect()
}

/// Directories a dialog-picked path may live in without any further approval:
/// the user's document locations (`Documents`, `Desktop`, `Downloads`) and the
/// per-user temporary directory.
///
/// Deliberately not `$HOME`: allowing it would let a picked path widen to every
/// dotfile in the account — `~/.ssh`, `~/.aws`, `~/.gnupg`, `~/Library` (keychain,
/// browser profiles) on macOS and `%APPDATA%` on Windows — and the mounted-volume
/// roots (`/Volumes` on macOS, `/media` and `/run/media` on Linux) would reach the
/// boot volume and other users' private files. Under the threat model at the top of
/// this file that is not hypothetical: the SVG exporter interpolates user-authored
/// strings into attributes.
///
/// Everything else is gated by [`approved_roots`] — a folder enters the policy only
/// because a person picked a file inside it in a native dialog. Mounted volumes are
/// left out of the fixed list for the same reason, and exporting to a USB drive
/// still works through that mechanism.
///
/// Folders that do not exist on this machine drop out silently, which is what keeps
/// the rejection message honest: it must never name a folder the check refuses, such
/// as `/tmp` on macOS, where `temp_dir()` resolves to the private `$TMPDIR`.
fn static_roots() -> Vec<PathBuf> {
    let mut roots: BTreeSet<PathBuf> = BTreeSet::new();
    for home in home_dirs() {
        for name in ["Documents", "Desktop", "Downloads"] {
            if let Ok(canonical) = home.join(name).canonicalize() {
                roots.insert(canonical);
            }
        }
    }
    // `$TMPDIR` (`/var/folders/…/T`, private) on macOS, `/tmp` on Linux: the save
    // dialog can legitimately be pointed there.
    if let Ok(canonical) = std::env::temp_dir().canonicalize() {
        roots.insert(canonical);
    }
    roots.into_iter().collect()
}

/// Folders the user approved for this run by choosing a file inside one of them
/// in the native open/save dialog.
///
/// Process memory only: it dies with the app, so a folder approved once does not
/// quietly become a permanent capability, and nothing is written to disk that a
/// later build could read back as an approval.
static APPROVED_ROOTS: OnceLock<Mutex<BTreeSet<PathBuf>>> = OnceLock::new();

fn approved_store() -> &'static Mutex<BTreeSet<PathBuf>> {
    APPROVED_ROOTS.get_or_init(|| Mutex::new(BTreeSet::new()))
}

fn approved_roots() -> Vec<PathBuf> {
    let guard = approved_store()
        .lock()
        .unwrap_or_else(PoisonError::into_inner);
    // A folder the user approved and later deleted cannot be written into anyway,
    // and keeping it would put an unusable path into the rejection message — which
    // promises that everything it names is usable.
    guard.iter().filter(|root| root.is_dir()).cloned().collect()
}

/// Remember the folder a person just picked a file in, if remembering it is safe.
fn remember_approved_root(dir: &Path) {
    if !widening_is_safe(dir) {
        return;
    }
    let canonical = dir.canonicalize().unwrap_or_else(|_| dir.to_path_buf());
    approved_store()
        .lock()
        .unwrap_or_else(PoisonError::into_inner)
        .insert(canonical);
}

/// Approving one file must not hand the whole policy back.
///
/// Without this, picking `/Users/me/.ssh/config` would approve `~/.ssh` and
/// picking `/Users/me/tree.nwk` would approve all of `$HOME` — precisely the hole
/// [`static_roots`] is designed to avoid. A folder is therefore only remembered
/// when it is not a filesystem or top-level folder (`/`, `/Volumes`, `C:\Users`),
/// not a home directory itself, and not a hidden folder sitting directly inside one
/// (`~/.ssh`, `~/.aws`, `~/.gnupg`). The one file the user actually chose stays
/// usable in every case; only the widening is refused.
fn widening_is_safe(dir: &Path) -> bool {
    let Some(parent) = dir.parent() else {
        return false; // `/` and `C:\` report no parent
    };
    if !dir.is_absolute() {
        return false;
    }
    // A top-level folder (`/Volumes`, `/Users`, `/usr`, `C:\Users`) is a whole tree,
    // not the folder a person meant to work in — and `/Volumes` by itself reaches the
    // boot volume and every other user's home, which no single approval should open.
    if parent.parent().is_none() {
        return false;
    }
    let canonical = dir.canonicalize().unwrap_or_else(|_| dir.to_path_buf());
    for home in home_dirs() {
        if canonical == home {
            return false;
        }
        if let Ok(relative) = canonical.strip_prefix(&home) {
            let hidden_direct_child = relative.components().count() == 1
                && relative
                    .file_name()
                    .and_then(|name| name.to_str())
                    .is_some_and(|name| name.starts_with('.'));
            if hidden_direct_child {
                return false;
            }
        }
    }
    true
}

/// Every root the policy accepts at this moment: the fixed document folders, the
/// temporary folder, and whatever a dialog approved earlier in this run.
fn allowed_roots() -> Vec<PathBuf> {
    let mut roots = static_roots();
    roots.extend(approved_roots());
    roots
}

/// The rejection text, generated from the roots themselves.
///
/// Hand-writing the list of folders lets the message and the policy disagree — and
/// the message is what the user trusts. Building it from [`allowed_roots`] makes
/// that structurally impossible: the folders named here are the folders the check
/// above actually accepted.
fn refusal(path: &Path) -> String {
    let roots = allowed_roots();
    let listed = if roots.is_empty() {
        String::from("none — this machine has no Documents, Desktop, Downloads or temp folder that could be resolved")
    } else {
        roots
            .iter()
            .map(|root| format!("`{}`", describe(root)))
            .collect::<Vec<String>>()
            .join(", ")
    };
    format!(
        "Refusing {}: it is outside the folders CladeForge may access ({}). To work somewhere else, choose the file with the open or save dialog: the folder you pick is then allowed for the rest of this session.",
        describe(path),
        listed
    )
}

fn describe(p: &Path) -> String {
    p.to_string_lossy().to_string()
}

/// The syntactic layer of [`validate_path`]: non-empty, absolute, no `..`.
///
/// Split out so the shared case table can exercise the rules the
/// client mirrors. A test that re-types these checks instead of calling them
/// cannot notice the real function drifting; calling this one is what keeps the
/// two sides consistent.
fn syntactic_rejection(raw: &str) -> Option<String> {
    if raw.trim().is_empty() {
        return Some("Empty path".to_string());
    }
    let path = Path::new(raw);
    if !path.is_absolute() {
        return Some(format!("Refusing relative path: {raw}"));
    }
    if path.components().any(|c| matches!(c, Component::ParentDir)) {
        return Some(format!("Refusing path containing '..': {raw}"));
    }
    None
}

/// Reject anything that is not an absolute, traversal-free path inside one of
/// `allowed_roots`, resolving symlinks so an escape cannot hide behind one.
///
/// Only `..` is rejected explicitly. `.` needs no check: `Path::components()`
/// normalises it away, so a `Component::CurDir` could never be observed here, and
/// guarding for it would imply a check that does not exist. Canonicalisation
/// collapses `.` regardless, so the guarantee that matters — no escaping the
/// allow-list — still holds.
///
/// `for_write` paths usually do not exist yet, so their *parent* is resolved and
/// the file name re-attached; an existing destination is resolved too, so a
/// symlink standing where the user meant to write cannot redirect the output.
///
/// The scope-free form of [`validate_path`], i.e. the policy with no dialog
/// approvals consulted at all. Only the tests need it; production calls go through
/// a command, which always has a window to ask.
#[cfg(test)]
fn validate_path(raw: &str, for_write: bool) -> Result<PathBuf, String> {
    validate_path_scoped(raw, for_write, None)
}

/// [`validate_path`]'s one escape hatch: a path the user selected in the native
/// open/save dialog.
///
/// `dialog_scope` is Tauri's own filesystem scope, which `tauri-plugin-fs` manages
/// and the **dialog plugin's Rust command handlers** extend with every path a
/// person picks (native drag-and-drop adds its drops the same way). A script in
/// the webview has no way to add an entry to it — it can only make the human look
/// at a dialog and click — so consulting it here is what turns "the user picked
/// this path" from an assumption into an established fact, and it is why the
/// allow-list does not have to cover all of `$HOME`.
///
/// The folder holding an approved file is remembered for the rest of the session
/// (subject to [`widening_is_safe`]), which is what keeps the second export of a
/// series — same folder, different file name, each chosen in its own dialog —
/// working without a fresh approval per file.
fn validate_path_scoped(
    raw: &str,
    for_write: bool,
    dialog_scope: Option<&tauri::fs::Scope>,
) -> Result<PathBuf, String> {
    if let Some(reason) = syntactic_rejection(raw) {
        return Err(reason);
    }
    let path = Path::new(raw);
    let resolved = if for_write {
        let parent = path
            .parent()
            .ok_or_else(|| format!("Path has no parent directory: {raw}"))?;
        let file = path
            .file_name()
            .ok_or_else(|| format!("Path has no file name: {raw}"))?;
        let anchor = parent
            .canonicalize()
            .map_err(|e| format!("Cannot resolve directory {}: {e}", describe(parent)))?;
        let target = anchor.join(file);
        // Overwriting an existing file must not follow a symlink out of scope.
        if let Ok(existing) = target.canonicalize() {
            existing
        } else {
            target
        }
    } else {
        path.canonicalize()
            .map_err(|e| format!("Cannot resolve {raw}: {e}"))?
    };
    let roots = allowed_roots();
    if roots.iter().any(|root| resolved.starts_with(root)) {
        return Ok(resolved);
    }
    if dialog_scope.is_some_and(|scope| scope.is_allowed(&resolved)) {
        if let Some(parent) = resolved.parent() {
            remember_approved_root(parent);
        }
        return Ok(resolved);
    }
    Err(refusal(&resolved))
}

/// Lightweight capability probe + the anchor of the native compute boundary.
#[tauri::command]
fn app_info() -> AppInfo {
    AppInfo {
        name: "CladeForge".to_string(),
        version: env!("CARGO_PKG_VERSION").to_string(),
        tauri: tauri::VERSION.to_string(),
    }
}

/// Read a UTF-8 text file the user selected via the open dialog.
///
/// `max_bytes` lets the caller ask for the ceiling that actually applies to the
/// document type it is about to parse. The frontend rejects a tree above
/// `MAX_TREE_CHARS` (64 MB) and a project above `MAX_PROJECT_CHARS` (192 MB), so
/// reading a 250 MB file to the full 256 MB ceiling means marshalling it into
/// memory, copying it across IPC as a JSON string, and only THEN refusing it —
/// several times the peak memory needed, after a visible stall.
/// Zero or an omitted value falls back to the hard ceiling.
#[tauri::command]
fn read_text_file(
    window: tauri::Window,
    path: String,
    max_bytes: Option<u64>,
) -> Result<String, String> {
    let target = validate_path_scoped(&path, false, window.try_fs_scope().as_ref())?;
    let limit = max_bytes.filter(|m| *m > 0).unwrap_or(MAX_READ_BYTES).min(MAX_READ_BYTES);
    let size = std::fs::metadata(&target)
        .map_err(|e| format!("Cannot stat {}: {e}", describe(&target)))?
        .len();
    if size > limit {
        return Err(format!(
            "{} is {} MB, above the {} MB limit for this kind of file",
            describe(&target),
            size / (1024 * 1024),
            limit / (1024 * 1024)
        ));
    }
    // Name the file: a bare "stream did not contain valid UTF-8" tells the user that
    // *a* file was not text without saying which one, and the app can be pointed at
    // several per import. No translation is attempted — this string, like the other
    // Rust-side errors, is English-only by design.
    std::fs::read_to_string(&target)
        .map_err(|e| format!("Cannot read {} as a text file: {e}", describe(&target)))
}

/// Write UTF-8 text to a path the user selected via the save dialog.
/// Uses atomic write (temp file + rename) so a crash mid-write cannot
/// truncate the user's project file.
#[tauri::command]
fn write_text_file(
    window: tauri::Window,
    path: String,
    contents: String,
) -> Result<(), String> {
    let target = validate_path_scoped(&path, true, window.try_fs_scope().as_ref())?;
    atomic_write(&target, contents.as_bytes())
}

/// Write raw bytes (PNG / PDF exports) to a user-selected save path.
/// Uses atomic write (temp file + rename) for the same crash-safety reason.
#[tauri::command]
fn write_binary_file(
    window: tauri::Window,
    path: String,
    contents: Vec<u8>,
) -> Result<(), String> {
    let target = validate_path_scoped(&path, true, window.try_fs_scope().as_ref())?;
    atomic_write(&target, &contents)
}

/// Where the temporary file is staged, and what this process owes the cleanup.
struct Staging {
    dir: PathBuf,
    /// True when this process created `dir` itself and must remove it again.
    /// False for the last-resort fallback (the bare temp dir), which is not ours
    /// to delete.
    owns_dir: bool,
}

/// A random token for temp names.
///
/// A bare nanosecond timestamp would not do: two processes can land on the same tick
/// and collide, and another account on a shared machine can predict the name and
/// pre-create the file. `std` exposes no CSPRNG without a dependency, so this folds
/// together OS entropy read from `/dev/urandom` where that exists, plus the pid, a
/// per-process counter, the clock and the ASLR'd address of a stack variable, and
/// mixes the result with the splitmix64 finaliser.
///
/// The token is defence in depth, not the load-bearing part: `O_CREAT | O_EXCL`
/// makes a collided or pre-created name fail (and the caller then retries with a
/// fresh token), and the staging directory is mode 0700, so nobody else can even
/// list what is inside.
fn random_token() -> String {
    static COUNTER: AtomicUsize = AtomicUsize::new(0);
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_nanos() as u64)
        .unwrap_or(0);
    let count = COUNTER.fetch_add(1, Ordering::Relaxed) as u64;
    let pid = std::process::id() as u64;
    let anchor = 0u8;
    // ASLR puts this stack variable at an address another account cannot predict.
    let stack = std::ptr::from_ref(&anchor).cast::<u8>() as usize as u64;
    let mut mixed = now ^ pid.rotate_left(11) ^ count.rotate_left(23) ^ stack.rotate_left(3);
    #[cfg(unix)]
    {
        use std::io::Read;
        // `read_exact`, never `fs::read`: /dev/urandom has no end to read to.
        if let Ok(mut file) = std::fs::File::open("/dev/urandom") {
            let mut buf = [0u8; 8];
            if file.read_exact(&mut buf).is_ok() {
                mixed ^= u64::from_le_bytes(buf);
            }
        }
    }
    mixed = (mixed ^ (mixed >> 30)).wrapping_mul(0xbf58_476d_1ce4_e5b9);
    mixed = (mixed ^ (mixed >> 27)).wrapping_mul(0x94d0_49bb_1331_11eb);
    format!("{:016x}", mixed ^ (mixed >> 31))
}

/// Create a directory only its owner can read, write or list.
///
/// Non-recursive on purpose: `create_dir_all` would happily accept a directory
/// somebody else pre-created (the classic `/tmp` squatting trick), and the mode is
/// then theirs, not ours.
#[cfg(unix)]
fn make_private_dir(dir: &Path) -> std::io::Result<()> {
    use std::os::unix::fs::DirBuilderExt;
    let mut builder = std::fs::DirBuilder::new();
    // mkdir(2) applies the umask, and 0700 has no group/other bits left to mask,
    // so this is the mode we get regardless of the caller's umask.
    builder.mode(0o700);
    builder.create(dir)
}

/// Windows has no 0700: the directory inherits its ACL from the parent, which is
/// why the staging area is tried next to the destination first and the temp file
/// itself is created with `O_EXCL`.
#[cfg(not(unix))]
fn make_private_dir(dir: &Path) -> std::io::Result<()> {
    std::fs::create_dir(dir)
}

/// Open `path` for writing, failing if the name exists at all.
///
/// `create_new` is `O_CREAT | O_EXCL`: unlike `File::create`, it neither follows nor
/// truncates a symlink somebody left in the staging area, and it never clobbers an
/// existing file. On unix the mode is 0600, so a half-written export is never
/// group- or world-readable even in the fallback case.
#[cfg(unix)]
fn create_exclusive(path: &Path) -> std::io::Result<std::fs::File> {
    use std::os::unix::fs::OpenOptionsExt;
    std::fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .mode(0o600)
        .open(path)
}

#[cfg(not(unix))]
fn create_exclusive(path: &Path) -> std::io::Result<std::fs::File> {
    std::fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(path)
}

/// Pick somewhere private to stage the temporary file.
///
/// Prefer a directory next to the destination: same filesystem, so the final
/// `rename` really is atomic. Fall back to a private directory in the per-user
/// temp dir when that parent is not writable (read-only volume, wrong ownership),
/// and only then to the temp dir itself.
fn staging_dir(dest_dir: &Path) -> Result<Staging, String> {
    let name = format!(".cladeforge-staging-{}-{}", std::process::id(), random_token());
    for candidate in [dest_dir.join(&name), std::env::temp_dir().join(&name)] {
        if make_private_dir(&candidate).is_ok() {
            return Ok(Staging {
                dir: candidate,
                owns_dir: true,
            });
        }
    }
    let temp = std::env::temp_dir();
    if temp.is_dir() {
        // Not private and not ours to remove, but writable: the file inside is
        // still created with O_EXCL and mode 0600 under an unguessable name.
        return Ok(Staging {
            dir: temp,
            owns_dir: false,
        });
    }
    Err(format!(
        "Cannot create a private temporary directory for {} or in {}",
        describe(dest_dir),
        describe(&temp)
    ))
}

/// Create the temporary file, retrying with a fresh token if the name is taken.
fn open_temp_file(staging: &Staging, dest: &Path) -> Result<(PathBuf, std::fs::File), String> {
    let stem = dest
        .file_name()
        .map(|name| {
            name.to_string_lossy()
                .chars()
                .map(|c| {
                    if c.is_alphanumeric() || c == '.' || c == '-' || c == '_' {
                        c
                    } else {
                        '_'
                    }
                })
                .collect::<String>()
        })
        .unwrap_or_else(|| String::from("cladeforge"));
    let mut reason = String::new();
    for _ in 0..8 {
        let pid = std::process::id();
        let token = random_token();
        let candidate = staging.dir.join(format!(".{stem}.cf-{pid}-{token}.tmp"));
        match create_exclusive(&candidate) {
            Ok(file) => return Ok((candidate, file)),
            Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => {
                // Somebody pre-created our guess. Try a new one; never reuse it.
                reason = format!(
                    "{} already existed: the staging area is being raced or squatted",
                    describe(&candidate)
                );
                continue;
            }
            Err(e) => {
                reason = format!(
                    "Cannot create a temporary file in {}: {e}",
                    describe(&staging.dir)
                );
                break;
            }
        }
    }
    if reason.is_empty() {
        reason = format!(
            "Cannot find an unused temporary file name in {}",
            describe(&staging.dir)
        );
    }
    Err(reason)
}

/// Remove the temporary file, and the staging directory if this process created
/// it.
///
/// Returns a description of anything that could not be removed instead of
/// discarding the error with `let _ =`: an orphaned temp file
/// in the user's Documents folder is the data we just wrote, left behind under a
/// name that looks like junk, and on the fallback path it is left somewhere other
/// accounts can see.
fn discard_staging(staging: &Staging, tmp: &Path) -> Option<String> {
    let mut problems: Vec<String> = Vec::new();
    if let Err(e) = std::fs::remove_file(tmp) {
        if e.kind() != std::io::ErrorKind::NotFound {
            problems.push(format!(
                "the temporary file {} could not be removed: {e}",
                describe(tmp)
            ));
        }
    }
    if staging.owns_dir {
        if let Err(e) = std::fs::remove_dir(&staging.dir) {
            // A non-empty staging directory is left alone rather than deleted
            // recursively: files inside it are not necessarily ours.
            if e.kind() != std::io::ErrorKind::NotFound {
                problems.push(format!(
                    "the staging directory {} could not be removed: {e}",
                    describe(&staging.dir)
                ));
            }
        }
    }
    if problems.is_empty() {
        None
    } else {
        Some(problems.join("; "))
    }
}

/// Join an operation's error with any cleanup error, so neither hides the other.
fn with_cleanup_note(error: String, cleanup: Option<String>) -> String {
    match cleanup {
        Some(note) => format!("{error}; in addition, {note}"),
        None => error,
    }
}

/// Flush a directory so an entry created or renamed inside it survives a crash.
///
/// The file's own `sync_all` makes the bytes durable; it says nothing about the
/// rename, which is a change to the *parent directory*. Without this flush an atomic
/// write can come back after a power loss as "the file is gone" or "the file is the
/// old one".
#[cfg(unix)]
fn sync_dir(dir: &Path) -> std::io::Result<()> {
    std::fs::File::open(dir)?.sync_all()
}

/// Opening a directory handle on Windows needs `FILE_FLAG_BACKUP_SECKEY`, which
/// `std::fs::File::open` does not set; the file-level `sync_all` before the rename
/// is therefore the strongest durability guarantee available without adding a
/// dependency on `windows-sys`.
#[cfg(not(unix))]
fn sync_dir(_dir: &Path) -> std::io::Result<()> {
    Ok(())
}

/// Give the temporary file the mode the destination is supposed to have.
///
/// The temp file is created 0600 so a half-written export can never be read, but
/// `rename` moves that inode into place, so without this every re-save would
/// silently tighten the user's existing files to owner-only — a figure copied to a
/// shared volume or served from a lab folder would stop opening for anybody else.
/// An existing regular file keeps its mode; anything else (new file, or a
/// destination that is not a file we should be copying modes from) gets the usual
/// 0644.
#[cfg(unix)]
fn finalise_mode(file: &std::fs::File, dest: &Path) -> std::io::Result<()> {
    use std::os::unix::fs::PermissionsExt;
    let mode = match std::fs::metadata(dest) {
        Ok(meta) if meta.is_file() => meta.permissions().mode() & 0o7777,
        _ => 0o644,
    };
    file.set_permissions(std::fs::Permissions::from_mode(mode))
}

/// NTFS permissions are inherited from the directory and have no mode bits, so
/// there is nothing to copy.
#[cfg(not(unix))]
fn finalise_mode(_file: &std::fs::File, _dest: &Path) -> std::io::Result<()> {
    Ok(())
}

/// Write `data` to a private temporary file, then rename it into place.
/// The rename is atomic on POSIX (same filesystem), so the destination
/// file is either the old version or the new version — never a partial write.
fn atomic_write(path: &Path, data: &[u8]) -> Result<(), String> {
    use std::io::Write;

    let dest_dir = path
        .parent()
        .ok_or_else(|| format!("{} has no parent directory", describe(path)))?;
    let staging = staging_dir(dest_dir)?;
    let (tmp_path, mut tmp) = open_temp_file(&staging, path)?;

    let written = (|| -> std::io::Result<()> {
        tmp.write_all(data)?;
        tmp.flush()?;
        // Before the single `sync_all` below, so the mode change is as durable as
        // the data.
        finalise_mode(&tmp, path)?;
        // Durability BEFORE the rename: without this, a crash can leave the
        // destination pointing at a file whose contents never reached the disk.
        tmp.sync_all()
    })();
    // Close the handle first: Windows refuses to rename over an open file.
    drop(tmp);

    if let Err(e) = written {
        return Err(with_cleanup_note(
            format!("Writing {} failed: {e}", describe(&tmp_path)),
            discard_staging(&staging, &tmp_path),
        ));
    }

    if let Err(e) = std::fs::rename(&tmp_path, path) {
        return Err(with_cleanup_note(
            format!(
                "Cannot move the temporary file into place as {}: {e}",
                describe(path)
            ),
            discard_staging(&staging, &tmp_path),
        ));
    }

    // The rename is only durable once the parent directory is flushed too. This
    // is deliberately not fatal: the bytes ARE in place, and reporting a failed
    // save would make the user overwrite a file that already exists. It is
    // reported rather than swallowed, on the one channel this crate has.
    if let Err(e) = sync_dir(dest_dir) {
        eprintln!(
            "CladeForge: {} was written, but its directory could not be flushed: {e}",
            describe(path)
        );
    }

    // Same reasoning as above — the user's file is saved, so a leftover private
    // staging directory must not turn the call into an error, but it must also not
    // be silent.
    if let Some(note) = discard_staging(&staging, &tmp_path) {
        eprintln!("CladeForge: {note}");
    }
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        // `tauri-plugin-fs` is initialised for one reason: it owns the filesystem
        // scope (`tauri::fs::Scope`) that the dialog plugin writes every
        // human-selected path into, and that scope is what lets `validate_path`
        // distinguish a path a person picked from one a script invented. No
        // `fs:` permission is granted in `capabilities/default.json`, so the webview
        // still cannot reach a single one of this plugin's commands — the plugin is
        // inert as an API and load-bearing as a record of approvals. Keep it that way:
        // granting `fs:*` would hand back the broad filesystem access this whole
        // module exists to avoid.
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            app_info,
            read_text_file,
            write_text_file,
            write_binary_file
        ])
        .run(tauri::generate_context!())
        .expect("error while running CladeForge");
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The two tests that involve the process-wide approval registry must not
    /// overlap: one grows it, the other compares a rejection message against a
    /// snapshot of it, and a root appearing between the two reads would make that
    /// comparison fail for reasons that have nothing to do with the code under test.
    static REGISTRY_LOCK: Mutex<()> = Mutex::new(());

    #[test]
    fn rejects_relative_and_traversal_paths() {
        assert!(validate_path("", false).is_err());
        assert!(validate_path("tree.nwk", false).is_err());
        assert!(validate_path("/etc/../etc/passwd", false).is_err());
        assert!(validate_path("/tmp/../../etc/shadow", true).is_err());
    }

    #[test]
    fn rejects_paths_outside_the_allow_list() {
        // A system path an arbitrary script would love to read or clobber.
        assert!(validate_path("/etc/hosts", false).is_err());
        assert!(validate_path("/etc/cladeforge-x", true).is_err());
        // Credentials such as `~/.ssh` must never become reachable, because `$HOME`
        // itself is not an allowed root. The directory is checked for *read*, so the
        // assertion is about the allow-list, not about whether it happens to exist.
        for home in home_dirs() {
            let ssh = home.join(".ssh");
            if ssh.is_dir() {
                assert!(
                    validate_path(&ssh.to_string_lossy(), false).is_err(),
                    "~/.ssh must not be inside the allow-list: {ssh:?}"
                );
            }
            // A plain folder in the home directory: legal for the human through the
            // dialog, refused for a script that only guesses the path.
            let elsewhere = home.join(format!("cladeforge-outside-{}", std::process::id()));
            assert!(
                validate_path(&elsewhere.to_string_lossy(), true).is_err(),
                "$HOME must not be whitelisted as a whole: {elsewhere:?}"
            );
        }
        // macOS mounts the boot volume under `/Volumes`, so a blanket volume root
        // would reach every other user's home too; it is not in the fixed list.
        if Path::new("/Volumes").is_dir() {
            assert!(validate_path("/Volumes", false).is_err());
        }
    }

    /// A rejection message must not advertise a folder the policy refuses: on macOS
    /// the text can name "the temporary folder" while `/tmp` is refused, because
    /// `temp_dir()` resolves to the private `$TMPDIR`, and users then hunt for a
    /// permission that does not exist. The message is generated from
    /// `allowed_roots()`, so the property is structural; this test keeps it true.
    #[test]
    fn the_rejection_message_names_exactly_the_allowed_folders() {
        let _guard = REGISTRY_LOCK.lock().unwrap_or_else(PoisonError::into_inner);
        let message = refusal(Path::new("/etc/cladeforge-x"));
        // `refusal` has already dropped any root that stopped existing, so apply the
        // same filter here rather than comparing against a longer list.
        let roots: Vec<PathBuf> = allowed_roots()
            .into_iter()
            .filter(|root| root.is_dir())
            .collect();
        for root in &roots {
            // Every folder the policy allows has to appear; hiding one is the
            // failure in the other direction. `/tmp` is what exposes it on macOS,
            // where `temp_dir()` is the private `$TMPDIR` while the text would name
            // "the temporary folder".
            let listed = format!("`{}`", describe(root));
            assert!(
                message.contains(&listed),
                "the policy allows {} but the rejection message hides it: {message}",
                describe(root)
            );
            let file = root.join(format!("cladeforge-listed-{}.nwk", std::process::id()));
            let write = validate_path(&file.to_string_lossy(), true);
            assert!(
                write.is_ok(),
                "{} is advertised as allowed but refused: {write:?}",
                describe(root)
            );
        }
        // And every folder the message does name has to be a root the policy accepts.
        // The roots are the only back-quoted things in the text, so parsing them out
        // checks the second direction without trusting a hand-written list. (Skipped
        // if a real root contains a backtick itself, which would make the parse
        // meaningless — that is a curiosity of the machine, not of the policy.)
        let parsable = roots.iter().all(|root| !describe(root).contains('`'));
        if parsable {
            let mut rest = message.as_str();
            let mut named: usize = 0;
            while let Some(start) = rest.find('`') {
                rest = &rest[start + 1..];
                let Some(end) = rest.find('`') else { break };
                let token = &rest[..end];
                rest = &rest[end + 1..];
                named += 1;
                assert!(
                    roots.iter().any(|root| describe(root) == token),
                    "the rejection message advertises {token}, which the policy refuses"
                );
            }
            if roots.is_empty() {
                // Nothing to advertise, so the message must say so in words rather
                // than name a folder at all.
                assert_eq!(
                    named, 0,
                    "no folder is allowed yet the message names one: {message}"
                );
            } else {
                assert_eq!(
                    named,
                    roots.len(),
                    "the message named {named} folders while the policy allows {}: {message}",
                    roots.len()
                );
            }
        }
    }

    /// The dialog half of the policy, exercised through the part a test can reach:
    /// the session registry `validate_path_scoped` fills from Tauri's filesystem
    /// scope. Building a real scope needs a running app, so the registry is filled
    /// directly — the rest of the path (folder refused before, accepted after) is
    /// the production code.
    #[test]
    fn a_folder_approved_by_a_dialog_is_usable_for_the_session() {
        let _guard = REGISTRY_LOCK.lock().unwrap_or_else(PoisonError::into_inner);
        let home = match home_dirs().first() {
            Some(home) => home.clone(),
            None => return, // no home directory to place the fixture in
        };
        let dir = home.join(format!("cladeforge-approval-{}", std::process::id()));
        if std::fs::create_dir_all(&dir).is_err() {
            return; // a home directory this process may not write in
        }
        let sibling = dir.join("figure.png");
        let as_str = sibling.to_string_lossy().to_string();
        assert!(
            validate_path(&as_str, true).is_err(),
            "a folder nobody approved must stay closed: {as_str}"
        );
        remember_approved_root(&dir);
        let after = validate_path(&as_str, true);
        if let Err(e) = std::fs::remove_dir(&dir) {
            eprintln!("CladeForge: the test fixture {dir:?} could not be removed: {e}");
        }
        assert!(
            after.is_ok(),
            "the folder a dialog approved should be usable: {after:?}"
        );
    }

    #[test]
    fn approving_one_file_never_approves_the_home_directory() {
        // `/`, a top-level tree and a home directory have no business being
        // remembered as roots. `/Volumes` is the one that matters on macOS: the boot
        // volume is mounted inside it, so approving it would reach every user's home.
        assert!(!widening_is_safe(Path::new("/")));
        assert!(!widening_is_safe(Path::new("/Volumes")));
        assert!(!widening_is_safe(Path::new("/Users")));
        for home in home_dirs() {
            assert!(
                !widening_is_safe(&home),
                "approving a file directly in $HOME must not reopen all of $HOME"
            );
            assert!(
                !widening_is_safe(&home.join(".ssh")),
                "a hidden folder directly inside $HOME must not widen to the session"
            );
            assert!(
                widening_is_safe(&home.join("Documents").join("paper")),
                "an ordinary nested folder should be memorable"
            );
        }
    }

    #[test]
    fn a_dot_component_is_normalised_not_rejected() {
        // components() drops '.', so the real contract is that the path is accepted
        // and canonicalised — there is no guard for '.' that could ever fire.
        let dir = std::env::temp_dir();
        let name = format!("cladeforge-probe-{}.nwk", std::process::id());
        let file = dir.join(&name);
        std::fs::write(&file, b"(A,B)R;").expect("write fixture");
        let with_dot = format!("{}/{}/{}", dir.display(), ".", name);
        let resolved = validate_path(&with_dot, false);
        remove_fixture(&file);
        assert!(
            resolved.is_ok(),
            "'.' is normalised by components(); the path should resolve: {resolved:?}"
        );
    }

    #[test]
    fn accepts_a_file_in_the_temporary_directory() {
        let dir = std::env::temp_dir();
        let name = format!("cladeforge-test-{}.nwk", std::process::id());
        let file = dir.join(name);
        std::fs::write(&file, b"(A,B)R;").expect("write fixture");
        let as_str = file.to_string_lossy().to_string();
        let read = validate_path(&as_str, false);
        let write = validate_path(&as_str, true);
        remove_fixture(&file);
        assert!(read.is_ok(), "temp file should be readable: {read:?}");
        assert!(write.is_ok(), "temp file should be writable: {write:?}");
    }

    /// The SAME case table as `CASES` in `src/io/native.test.ts`. The client
    /// assertion and this command are the same rules written twice, in two
    /// languages, so both sides run this table to keep them identical.
    ///
    /// Only the syntactic rules are compared: canonicalisation, symlink resolution
    /// and the root allow-list need the path to exist on disk, which a shared
    /// table cannot assume.
    ///
    /// The loop calls `syntactic_rejection` — the function `validate_path` actually
    /// uses. Re-typing these three checks inline would make the table a test of
    /// itself: a change to the real rules would then pass silently.
    #[test]
    fn path_rule_table_matches_the_client() {
        // (path, accepted_by_the_syntactic_rules, note)
        //
        // `Path::is_absolute()` is platform-aware in both directions, and the POSIX
        // rows are affected: on Windows a drive-less `/home/u/tree.nwk` is
        // root-relative, not absolute, so the authoritative Rust rule rejects a shape
        // the cheap client pre-check lets through. That divergence is deliberate and
        // fails closed — the client never grants access, Rust decides — so the table
        // records what each host actually does rather than one ideal.
        let posix_absolute = !cfg!(windows);
        let mut cases: Vec<(&str, bool, &str)> = vec![
            ("", false, "empty"),
            ("   ", false, "whitespace only"),
            ("tree.nwk", false, "relative"),
            ("./tree.nwk", false, "relative with leading dot"),
            ("../tree.nwk", false, "relative traversal"),
            (
                "/home/u/tree.nwk",
                posix_absolute,
                "absolute POSIX; root-relative, so not absolute, on Windows",
            ),
            ("/home/u/../etc/passwd", false, "absolute with traversal"),
            ("/etc/../etc/passwd", false, "system path with traversal"),
            (
                "/home/u/./tree.nwk",
                posix_absolute,
                "dot component is normalised, not rejected",
            ),
        ];
        // `Path::is_absolute()` is platform-aware: a drive-letter or UNC path is
        // absolute only on Windows. The client accepts Windows syntax everywhere
        // because it is only a cheap pre-check and Rust is authoritative, so the
        // shared table compares Windows shapes only where this binary can call
        // them absolute.
        if cfg!(windows) {
            cases.extend_from_slice(&[
                ("C:\\Users\\u\\tree.nwk", true, "absolute Windows drive"),
                ("C:\\Users\\u\\..\\windows\\x", false, "Windows traversal"),
                ("\\\\server\\share\\tree.nwk", true, "Windows UNC"),
                ("\\\\server\\share\\..\\x", false, "UNC traversal"),
            ]);
        }
        for (raw, accept, note) in cases.iter().copied() {
            let rejected = syntactic_rejection(raw).is_some();
            assert_eq!(
                !rejected, accept,
                "rule mismatch for {raw:?} ({note}) — the client table in src/io/native.test.ts must agree"
            );
        }
        // Guard the guard: an all-true or all-false table proves nothing.
        assert!(
            cases.iter().any(|(_, accept, _)| *accept),
            "table accepts nothing"
        );
        assert!(
            cases.iter().any(|(_, accept, _)| !*accept),
            "table rejects nothing"
        );
    }

    #[test]
    fn atomic_write_replaces_the_destination() {
        let dir = std::env::temp_dir().join(format!("cladeforge-atomic-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let target = dir.join("out.nwk");
        atomic_write(&target, b"(A,B)R;").unwrap();
        assert_eq!(std::fs::read_to_string(&target).unwrap(), "(A,B)R;");
        atomic_write(&target, b"(C,D)R;").unwrap();
        assert_eq!(std::fs::read_to_string(&target).unwrap(), "(C,D)R;");
        // A save must leave exactly one file behind. The staging directory and
        // the temporary file inside it are this process's litter, so their absence is
        // part of the contract, not a detail.
        let leftovers = entries_of(&dir);
        assert_eq!(
            leftovers,
            vec![target.clone()],
            "atomic_write left {leftovers:?} behind in {}",
            describe(&dir)
        );
        std::fs::remove_dir_all(&dir).expect("remove the fixture directory");
    }

    #[test]
    fn a_failed_rename_leaves_no_temporary_file_behind() {
        let dir = std::env::temp_dir().join(format!("cladeforge-rename-{}", std::process::id()));
        std::fs::create_dir_all(&dir).expect("create the fixture directory");
        // Renaming a file onto an existing DIRECTORY fails on every platform this app
        // targets, which is the cheapest reproducible way into the failure path whose
        // own cleanup error must not be swallowed.
        let blocker = dir.join("out.nwk");
        std::fs::create_dir(&blocker).expect("create the blocking directory");
        let error = atomic_write(&blocker, b"(A,B)R;")
            .expect_err("renaming onto a directory must fail");
        let leftovers = entries_of(&dir);
        assert_eq!(
            leftovers,
            vec![blocker.clone()],
            "the failed write left {leftovers:?} behind: {error}"
        );
        std::fs::remove_dir_all(&dir).expect("remove the fixture directory");
    }

    #[test]
    fn temp_names_are_unique_and_not_a_bare_timestamp() {
        // A name built from `SystemTime` nanoseconds alone can collide across
        // processes and be guessed by whoever shares the temp directory.
        let first = random_token();
        let second = random_token();
        assert_ne!(first, second, "two tokens must not be identical");
        assert_eq!(first.len(), 16, "{first} is not a full 64-bit hex token");
        assert!(
            first.chars().all(|c| c.is_ascii_hexdigit()),
            "{first} should be hexadecimal"
        );
    }

    /// Test teardown that reports instead of swallowing: `let _ =` on a cleanup hides
    /// the failure, and a fixture left on a developer's machine is worth knowing.
    fn remove_fixture(path: &Path) {
        if let Err(e) = std::fs::remove_file(path) {
            eprintln!("CladeForge: the test fixture {path:?} could not be removed: {e}");
        }
    }

    fn entries_of(dir: &Path) -> Vec<PathBuf> {
        std::fs::read_dir(dir)
            .expect("read the fixture directory")
            .filter_map(|entry| entry.ok().map(|entry| entry.path()))
            .collect()
    }
}
