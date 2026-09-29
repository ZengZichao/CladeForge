// Renders one tree node: marker shape, label, selection/collapse indicators,
// an inline rename editor, and a connection "port" handle for starting custom
// edges. Interaction (select / drag / connect) is handled centrally by
// TreeCanvas via event delegation; this component only manages its own hover
// and rename-editing local state.

import { memo, useEffect, useRef, useState } from 'react';
import { useStore } from '../model/store';
import { renameNode } from '../model/treeOps';
import { DEFAULT_NODE_STYLE, type NodeStyle, type Orientation, type Point, type TreeNode } from '../model/types';
import { labelPlacement } from './labels';
import { isImeComposing } from '../ui/imeGuard';
import { markerPath } from './markerGeometry';
import { S, tr } from '../ui/strings';
import { C_SELECT, C_DROP, C_CONNECT, C_UNKNOWN } from './colors';

interface NodeViewProps {
  node: TreeNode;
  pos: Point;
  style: NodeStyle;
  orientation: Orientation;
  isLeaf: boolean;
  isDropTarget: boolean;
  isConnectSource: boolean;
  /** When a character is active, the state colour (undefined = unassigned). */
  characterActive?: boolean;
  characterColor?: string;
  /**
   * Radial (parent → node) angle for the circular layout, in radians. Omitted
   * for rectangular layouts, where the orientation decides the side.
   */
  labelAngle?: number;
}

function Marker({
  style,
  role,
  id,
  fill,
  stroke,
  dashed,
}: {
  style: NodeStyle;
  role: string;
  id: string;
  fill: string;
  stroke: string;
  dashed?: boolean;
}) {
  if (style.shape === 'none') {
    // Invisible but clickable hit target so the node stays selectable.
    return <circle r={7} data-role={role} data-node-id={id} fill="transparent" />;
  }
  return (
    <path
      d={markerPath(style.shape, 0, 0, style.size)}
      data-role={role}
      data-node-id={id}
      fill={fill}
      stroke={stroke}
      strokeWidth={style.strokeWidth}
      strokeDasharray={dashed ? '2 2' : undefined}
    />
  );
}

export const NodeView = memo(function NodeView({
  node,
  pos,
  style,
  orientation,
  isLeaf,
  isDropTarget,
  isConnectSource,
  characterActive,
  characterColor,
  labelAngle,
}: NodeViewProps) {
  const selected = useStore((s) => s.selection.includes(node.id));
  const apply = useStore((s) => s.apply);

  const [hovered, setHovered] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(node.label);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editing) {
      setDraft(node.label);
      // Focus after the input mounts.
      requestAnimationFrame(() => inputRef.current?.select());
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editing]);

  const commitRename = () => {
    setEditing(false);
    if (draft !== node.label) apply((d) => renameNode(d, node.id, draft));
  };

  const place = labelPlacement(
    orientation,
    isLeaf,
    style.size,
    style.labelPosition,
    style.labelOffsetX,
    style.labelOffsetY,
    labelAngle,
  );
  const showPort = hovered || selected;
  const showLabel = style.showLabel && (node.label !== '' || editing);

  // Accessible name: label + support + leaf/internal, for the tree role.
  const ariaLabel = [
    node.label || tr('未命名节点', 'Unnamed node'),
    isLeaf ? tr('末端', 'Tip') : tr('内部节点', 'Internal node'),
    node.support !== undefined ? `${tr('支持率', 'Support')} ${node.support}` : '',
    node.age !== undefined ? `${tr('年代', 'Age')} ${node.age}` : '',
  ]
    .filter(Boolean)
    .join('，');

  // When colouring by a character, an unassigned node reads as "unknown":
  // a hollow marker with a dashed grey outline, prompting a hypothesis.
  const markerFill = characterActive ? (characterColor ?? 'var(--surface)') : style.fill;
  const markerStroke = characterActive && !characterColor ? C_UNKNOWN : style.stroke;
  const markerDashed = characterActive === true && !characterColor;

  return (
    <g
      transform={`translate(${pos.x} ${pos.y})`}
      role="treeitem"
      aria-label={ariaLabel}
      aria-selected={selected || undefined}
      aria-expanded={node.collapsed ? false : node.childrenIds.length > 0 ? true : undefined}
      onPointerEnter={() => setHovered(true)}
      onPointerLeave={() => setHovered(false)}
      onDoubleClick={(e) => {
        e.stopPropagation();
        setEditing(true);
      }}
      style={{ cursor: 'pointer' }}
    >
      {/* Double-layer selection highlight (Sketch/Figma/XD style):
          Outer halo: wide, very translucent (glow).
          Inner ring: narrower, more opaque (focus ring).
          Together they create the "glow + ring" effect. */}
      {selected && !isDropTarget && (
        <>
          <circle r={style.size + 8} className="node-halo" />
          <circle r={style.size + 4} className="node-ring" />
        </>
      )}
      {isDropTarget && (
        <>
          <circle r={style.size + 8} className="node-halo-drop" />
          <circle r={style.size + 4} className="node-ring-drop" />
        </>
      )}
      {isConnectSource && (
        <circle r={style.size + 9} fill="none" stroke={C_CONNECT} strokeWidth={2} opacity={0.6} />
      )}

      <Marker style={style} role="node" id={node.id} fill={markerFill} stroke={markerStroke} dashed={markerDashed} />

      {node.collapsed && node.childrenIds.length > 0 && (
        <path
          d={`M ${style.size + 2} ${-4} L ${style.size + 10} 0 L ${style.size + 2} 4 Z`}
          fill={style.stroke}
          data-role="node"
          data-node-id={node.id}
        />
      )}

      {showLabel && !editing && (
        <text
          x={place.dx}
          y={place.dy}
          textAnchor={place.anchor}
          dominantBaseline={place.baseline}
          fontSize={style.fontSize}
          fontStyle={style.fontStyle}
          fontWeight={style.fontWeight}
          fill={
            // Default label colour (#111111) is unreadable on the dark canvas;
            // use the theme text colour when the user has not customised it.
            style.labelColor === DEFAULT_NODE_STYLE.labelColor
              ? 'var(--text)'
              : style.labelColor
          }
          transform={
            style.labelRotation ? `rotate(${style.labelRotation} ${place.dx} ${place.dy})` : undefined
          }
          data-role="node"
          data-node-id={node.id}
          style={{ userSelect: 'none' }}
        >
          {node.label}
        </text>
      )}

      {editing && (
        <foreignObject
          x={-70}
          y={-(style.size + 30)}
          width={140}
          height={26}
          onPointerDown={(e) => e.stopPropagation()}
        >
          <input
            ref={inputRef}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commitRename}
            onKeyDown={(e) => {
              // The inline rename field is where CJK input happens most, so an
              // open composition owns the keys: Enter accepts an IME candidate
              // (it must not commit the half-written label) and Escape cancels
              // the composition.
              if (isImeComposing(e)) {
                e.stopPropagation();
                return;
              }
              if (e.key === 'Enter') commitRename();
              else if (e.key === 'Escape') setEditing(false);
              e.stopPropagation();
            }}
            style={{
              width: '100%',
              boxSizing: 'border-box',
              textAlign: 'center',
              fontSize: 13,
              border: `1px solid ${C_SELECT}`,
              borderRadius: 4,
              padding: '2px 4px',
              outline: 'none',
            }}
          />
        </foreignObject>
      )}

      {showPort && (
        <circle
          cx={style.size + 11}
          cy={-(style.size + 11)}
          r={5}
          fill={C_SELECT}
          stroke="var(--surface)"
          strokeWidth={1.5}
          data-role="port"
          data-node-id={node.id}
          style={{ cursor: 'crosshair' }}
        >
          <title>{S.node.portTitle}</title>
        </circle>
      )}
    </g>
  );
});
