
import { useEffect, useState } from "react";

interface AudioVisualizerProps {
  isActive: boolean;
  audioLevel: number;
}

const AudioVisualizer = ({ isActive, audioLevel }: AudioVisualizerProps) => {
  const [bars, setBars] = useState<number[]>(new Array(20).fill(0));

  useEffect(() => {
    if (isActive) {
      const interval = setInterval(() => {
        setBars(prev => prev.map(() => Math.random() * audioLevel));
      }, 100);
      return () => clearInterval(interval);
    } else {
      setBars(new Array(20).fill(0));
    }
  }, [isActive, audioLevel]);

  return (
    <div className="flex items-center justify-center h-20 bg-gray-900 rounded-lg p-4">
      <div className="flex items-end space-x-1">
        {bars.map((height, index) => (
          <div
            key={index}
            className="bg-gradient-to-t from-blue-500 to-cyan-400 w-2 rounded-t transition-all duration-100"
            style={{
              height: `${Math.max(2, height)}px`,
              opacity: isActive ? 1 : 0.3,
            }}
          />
        ))}
      </div>
    </div>
  );
};

export default AudioVisualizer;
