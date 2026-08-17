import React, { useRef, useEffect, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import occtimportjs from 'occt-import-js';
import { Loader2, AlertCircle, Box, Eye } from 'lucide-react';

const OCCT_WASM_URL = 'https://cdn.jsdelivr.net/npm/occt-import-js@0.0.23/dist/occt-import-js.wasm';

let occtInstance = null;
async function getOcct() {
  if (occtInstance) return occtInstance;
  occtInstance = await occtimportjs({
    locateFile: (path) => (path.endsWith('.wasm') ? OCCT_WASM_URL : path),
  });
  return occtInstance;
}

export default function CADViewer({ fileUrl, fileName }) {
  const mountRef = useRef(null);
  const sceneRef = useRef(null);
  const rendererRef = useRef(null);
  const cameraRef = useRef(null);
  const controlsRef = useRef(null);
  const modelGroupRef = useRef(null);
  const animationIdRef = useRef(null);
  const [status, setStatus] = useState('idle');
  const [error, setError] = useState('');
  const [meshCount, setMeshCount] = useState(0);

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;

    const width = mount.clientWidth || 600;
    const height = mount.clientHeight || 400;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x1e293b);

    const camera = new THREE.PerspectiveCamera(50, width / height, 0.1, 1000000);
    camera.position.set(15, 15, 15);

    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(width, height);
    renderer.setPixelRatio(window.devicePixelRatio);
    mount.appendChild(renderer.domElement);

    scene.add(new THREE.AmbientLight(0xffffff, 0.5));
    const dirLight1 = new THREE.DirectionalLight(0xffffff, 0.8);
    dirLight1.position.set(1, 1.5, 1);
    scene.add(dirLight1);
    const dirLight2 = new THREE.DirectionalLight(0xffffff, 0.3);
    dirLight2.position.set(-1, -0.5, -1);
    scene.add(dirLight2);

    const grid = new THREE.GridHelper(50, 50, 0x475569, 0x334155);
    scene.add(grid);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.1;

    const modelGroup = new THREE.Group();
    scene.add(modelGroup);

    sceneRef.current = scene;
    rendererRef.current = renderer;
    cameraRef.current = camera;
    controlsRef.current = controls;
    modelGroupRef.current = modelGroup;

    const animate = () => {
      animationIdRef.current = requestAnimationFrame(animate);
      controls.update();
      renderer.render(scene, camera);
    };
    animate();

    const handleResize = () => {
      const w = mount.clientWidth;
      const h = mount.clientHeight;
      if (w > 0 && h > 0) {
        camera.aspect = w / h;
        camera.updateProjectionMatrix();
        renderer.setSize(w, h);
      }
    };
    const resizeObserver = new ResizeObserver(handleResize);
    resizeObserver.observe(mount);

    return () => {
      cancelAnimationFrame(animationIdRef.current);
      resizeObserver.disconnect();
      controls.dispose();
      renderer.dispose();
      if (renderer.domElement.parentNode === mount) {
        mount.removeChild(renderer.domElement);
      }
    };
  }, []);

  useEffect(() => {
    if (!fileUrl) {
      setStatus('idle');
      return;
    }
    let cancelled = false;
    const load = async () => {
      setStatus('loading');
      setError('');
      try {
        const response = await fetch(fileUrl);
        if (!response.ok) throw new Error('Failed to download file');
        const buffer = await response.arrayBuffer();
        const uint8 = new Uint8Array(buffer);

        const occt = await getOcct();
        const ext = (fileName || fileUrl).split('.').pop().toLowerCase();
        let result;
        if (ext === 'step' || ext === 'stp') {
          result = occt.ReadStepFile(uint8, null);
        } else if (ext === 'iges' || ext === 'igs') {
          result = occt.ReadIgesFile(uint8, null);
        } else if (ext === 'brep') {
          result = occt.ReadBrepFile(uint8, null);
        } else {
          throw new Error('Unsupported format. Use STEP, IGES, or BREP files.');
        }

        if (!result.success) throw new Error('Failed to parse CAD file');
        if (cancelled) return;

        renderMeshes(result.meshes);
        setMeshCount(result.meshes.length);
        setStatus('ready');
      } catch (err) {
        if (!cancelled) {
          setStatus('error');
          setError(err.message);
        }
      }
    };
    load();
    return () => { cancelled = true; };
  }, [fileUrl, fileName]);

  const renderMeshes = (meshes) => {
    const group = modelGroupRef.current;
    while (group.children.length > 0) {
      const child = group.children[0];
      group.remove(child);
      if (child.geometry) child.geometry.dispose();
      if (child.material) child.material.dispose();
    }

    const bbox = new THREE.Box3();

    meshes.forEach((mesh) => {
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(mesh.attributes.position.array), 3));
      if (mesh.attributes.normal) {
        geometry.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(mesh.attributes.normal.array), 3));
      }
      if (mesh.index) {
        geometry.setIndex(new THREE.BufferAttribute(new Uint32Array(mesh.index.array), 1));
      }

      const color = mesh.color
        ? new THREE.Color(mesh.color[0], mesh.color[1], mesh.color[2])
        : new THREE.Color(0xaaaaaa);

      const material = new THREE.MeshPhongMaterial({
        color,
        side: THREE.DoubleSide,
        specular: 0x333333,
        shininess: 30,
      });

      const threeMesh = new THREE.Mesh(geometry, material);
      group.add(threeMesh);
      bbox.expandByObject(threeMesh);
    });

    if (!bbox.isEmpty()) {
      const center = bbox.getCenter(new THREE.Vector3());
      const size = bbox.getSize(new THREE.Vector3());
      const maxDim = Math.max(size.x, size.y, size.z) || 10;
      const fov = cameraRef.current.fov * (Math.PI / 180);
      const cameraZ = Math.abs(maxDim / Math.sin(fov / 2)) * 0.7;

      cameraRef.current.position.set(
        center.x + cameraZ * 0.5,
        center.y + cameraZ * 0.5,
        center.z + cameraZ
      );
      cameraRef.current.lookAt(center);
      cameraRef.current.updateProjectionMatrix();
      controlsRef.current.target.copy(center);
      controlsRef.current.update();
    }
  };

  return (
    <div className="relative w-full h-full bg-slate-900 rounded-lg overflow-hidden">
      <div ref={mountRef} className="w-full h-full" />
      {status === 'idle' && (
        <div className="absolute inset-0 flex flex-col items-center justify-center text-slate-400">
          <Eye className="w-12 h-12 mb-2 opacity-30" />
          <p className="text-sm">Select a CAD file to preview</p>
        </div>
      )}
      {status === 'loading' && (
        <div className="absolute inset-0 flex flex-col items-center justify-center bg-slate-900/80 text-white">
          <Loader2 className="w-8 h-8 animate-spin mb-2" />
          <p className="text-sm">Loading 3D model...</p>
        </div>
      )}
      {status === 'error' && (
        <div className="absolute inset-0 flex flex-col items-center justify-center bg-slate-900/80 text-red-400 p-4">
          <AlertCircle className="w-8 h-8 mb-2" />
          <p className="text-sm text-center">{error}</p>
        </div>
      )}
      {status === 'ready' && (
        <div className="absolute top-2 left-2 bg-slate-800/80 text-slate-300 px-2 py-1 rounded text-xs pointer-events-none">
          <Box className="w-3 h-3 inline mr-1" />
          {meshCount} mesh{meshCount !== 1 ? 'es' : ''} • {fileName}
        </div>
      )}
    </div>
  );
}