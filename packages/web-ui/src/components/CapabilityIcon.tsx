/**
 * Capability icon component for displaying model quality/speed tiers.
 *
 * Uses fire SVG icons with different intensities to represent
 * capability levels (basic/standard/advanced).
 */
import React from 'react';

interface CapabilityIconProps {
  capability: 'fast' | 'medium' | 'slow' | 'basic' | 'standard' | 'advanced';
  size?: number;
}

export const CapabilityIcon: React.FC<CapabilityIconProps> = ({ capability, size = 16 }) => {
  const getColor = () => {
    switch (capability) {
      case 'fast':
      case 'basic':
        return '#4da6ff'; // Blue
      case 'medium':
      case 'standard':
        return '#ffd24d'; // Yellow
      case 'slow':
      case 'advanced':
        return '#ff4d4d'; // Red
      default:
        return '#888888';
    }
  };
  
  const getFireIntensity = () => {
    switch (capability) {
      case 'fast':
      case 'basic':
        return 1; // Single flame
      case 'medium':
      case 'standard':
        return 2; // Double flame
      case 'slow':
      case 'advanced':
        return 3; // Triple flame
      default:
        return 1;
    }
  };
  
  const intensity = getFireIntensity();
  const color = getColor();
  
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      {/* Base flame */}
      <path
        d="M12 2C12 2 8 6 8 10C8 12 10 14 12 14C14 14 16 12 16 10C16 6 12 2 12 2Z"
        fill={color}
        opacity={0.6}
      />
      {intensity >= 2 && (
        <path
          d="M12 4C12 4 9 7 9 9C9 11 10.5 12.5 12 12.5C13.5 12.5 15 11 15 9C15 7 12 4 12 4Z"
          fill={color}
          opacity={0.8}
        />
      )}
      {intensity >= 3 && (
        <path
          d="M12 6C12 6 10 8 10 9C10 10 11 11 12 11C13 11 14 10 14 9C14 8 12 6 12 6Z"
          fill={color}
          opacity={1}
        />
      )}
    </svg>
  );
};
