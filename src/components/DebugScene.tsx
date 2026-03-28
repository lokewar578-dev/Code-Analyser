import React, { useRef } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { Sphere, OrbitControls, Text } from '@react-three/drei';
import * as THREE from 'three';

interface DebugSceneProps {
  errors: { line: number; description: string }[];
}

const ErrorNode = ({ position, description }: { position: [number, number, number]; description: string }) => {
  const mesh = useRef<THREE.Mesh>(null);
  useFrame((state) => {
    if (mesh.current) {
      mesh.current.rotation.y += 0.01;
    }
  });

  return (
    <group position={position}>
      <Sphere ref={mesh} args={[0.3, 32, 32]}>
        <meshStandardMaterial 
          color="#ff00ff" 
          emissive="#ff00ff" 
          emissiveIntensity={2} 
          wireframe 
        />
      </Sphere>
      <Text position={[0, 0.5, 0]} fontSize={0.2} color="white">
        {description.substring(0, 20)}...
      </Text>
    </group>
  );
};

export const DebugScene: React.FC<DebugSceneProps> = ({ errors }) => {
  return (
    <div className="w-full h-[400px] bg-black rounded-xl overflow-hidden border border-indigo-500/50 shadow-[0_0_20px_rgba(79,70,229,0.3)]">
      <Canvas camera={{ position: [0, 0, 5] }}>
        <ambientLight intensity={0.5} />
        <pointLight position={[10, 10, 10]} />
        {errors.map((error, index) => (
          <ErrorNode 
            key={index} 
            position={[(index % 3) * 2 - 2, Math.floor(index / 3) * 2 - 2, 0]} 
            description={error.description} 
          />
        ))}
        <OrbitControls />
      </Canvas>
    </div>
  );
};
