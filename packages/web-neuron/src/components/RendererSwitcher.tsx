// Bottom-footer renderer switcher. A segmented control that lets the user
// switch between the available graph renderers (force3d default, Cosmograph
// when WebGPU + GPU are present). Unavailable renderers are shown dimmed with
// a tooltip explaining why. A ⚙ toggle force-enables Cosmograph for testing.
// The surrounding HUD / side panel / theme are untouched — only this bar is
// added, and the existing bottom-left telemetry is nudged up to clear it.
import { useState } from 'react';
import { NEON } from '../renderers/palette.ts';
import { setCosmographForceOverride, refreshCapabilities } from '../renderers/capability.ts';
import type { CapabilityReport } from '../renderers/capability.ts';
import type { RendererDescriptor, RendererId } from '../renderers/index.ts';

const FOOTER_HEIGHT = 34;
export { FOOTER_HEIGHT };

interface Props {
  renderers: RendererDescriptor[];
  activeId: RendererId;
  caps: CapabilityReport;
  onSelect: (id: RendererId) => void;
  onCapabilitiesChanged: (caps: CapabilityReport) => void;
  panelWidth: number;
}

export function RendererSwitcher({ renderers, activeId, caps, onSelect, onCapabilitiesChanged, panelWidth }: Props) {
  const [overrideOn, setOverrideOn] = useState(
    typeof localStorage !== 'undefined' && localStorage.getItem('agx:cosmograph:force') === '1',
  );

  const toggleOverride = () => {
    const next = !overrideOn;
    setCosmographForceOverride(next);
    setOverrideOn(next);
    onCapabilitiesChanged(refreshCapabilities());
  };

  const bar: React.CSSProperties = {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: panelWidth,
    height: FOOTER_HEIGHT,
    display: 'flex',
    alignItems: 'center',
    gap: 14,
    padding: '0 16px',
    backgroundColor: 'rgba(2, 6, 15, 0.85)',
    borderTop: '1px solid rgba(125, 249, 255, 0.18)',
    backdropFilter: 'blur(10px)',
    fontFamily: "'JetBrains Mono', monospace",
    color: NEON.cyan,
    zIndex: 60,
    userSelect: 'none',
  };

  const labelStyle: React.CSSProperties = {
    fontSize: 10,
    letterSpacing: 2,
    opacity: 0.6,
  };

  const segBase: React.CSSProperties = {
    fontSize: 10,
    letterSpacing: 1.5,
    padding: '4px 12px',
    borderRadius: 2,
    cursor: 'pointer',
    fontFamily: "'JetBrains Mono', monospace",
    border: '1px solid rgba(125, 249, 255, 0.25)',
    color: '#fff',
    background: 'transparent',
    transition: 'all 0.15s ease',
  };

  const chip: React.CSSProperties = {
    fontSize: 10,
    letterSpacing: 1,
    padding: '2px 8px',
    border: '1px solid rgba(125, 249, 255, 0.18)',
    borderRadius: 2,
    color: NEON.cyan,
    opacity: 0.85,
  };

  return (
    <div style={bar}>
      <span style={labelStyle}>RENDERER</span>
      <div style={{ display: 'flex', gap: 6 }}>
        {renderers.map((r) => {
          const active = r.id === activeId;
          const disabled = !r.available;
          const style: React.CSSProperties = {
            ...segBase,
            ...(active
              ? {
                  background: 'rgba(125, 249, 255, 0.16)',
                  borderColor: 'rgba(125, 249, 255, 0.65)',
                  color: NEON.cyan,
                  boxShadow: '0 0 10px rgba(125, 249, 255, 0.25)',
                }
              : {}),
            ...(disabled
              ? { opacity: 0.35, cursor: 'not-allowed', borderColor: 'rgba(255,255,255,0.12)' }
              : {}),
          };
          return (
            <button
              key={r.id}
              style={style}
              title={disabled ? r.reason : r.label}
              onClick={() => {
                if (disabled) return;
                onSelect(r.id);
              }}
            >
              {r.label}
            </button>
          );
        })}
      </div>

      <div style={{ flex: 1 }} />

      <span style={chip}>◈ WebGPU: {caps.webgpu ? 'ON' : 'OFF'}</span>
      <span style={chip}>{caps.hardwareConcurrency || '?'} CORES</span>
      <button
        style={{
          ...chip,
          cursor: 'pointer',
          background: overrideOn ? 'rgba(125, 249, 255, 0.16)' : 'transparent',
          borderColor: overrideOn ? 'rgba(125, 249, 255, 0.65)' : 'rgba(125, 249, 255, 0.18)',
        }}
        title="Force-enable Cosmograph (may be slow without WebGPU)"
        onClick={toggleOverride}
      >
        ⚙ COSMO {overrideOn ? 'FORCE' : 'AUTO'}
      </button>
    </div>
  );
}
