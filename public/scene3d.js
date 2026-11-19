import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

const BoardConfig = window.BoardConfig;

const DICE_FACE_ROTATIONS = {
  1: { x: 0, z: 0 },
  2: { x: -Math.PI / 2, z: 0 },
  3: { x: 0, z: Math.PI / 2 },
  4: { x: 0, z: -Math.PI / 2 },
  5: { x: Math.PI / 2, z: 0 },
  6: { x: Math.PI, z: 0 }
};

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function easeOutCubic(t) {
  return 1 - Math.pow(1 - t, 3);
}

function easeInOutQuad(t) {
  return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
}

export class GameScene3D {
  constructor(container, overlayLayer) {
    this.container = container;
    this.overlayLayer = overlayLayer;

    this.theme = 'day';
    this.boardStyle = 'mountain';
    this.autoFollow = true;
    this.userDragging = false;
    this.cameraPresetLockUntil = 0;

    this.pawns = new Map();
    this.pawnTargets = new Map();
    this.pawnMeta = new Map(); // { name, characterId, tile, shield, isActive }
    this.overlayEls = new Map();
    this.emoteTimeouts = new Map();

    this.mysteryMeshes = [];
    this.mountainMysteryMeshes = [];
    this.snakeCurves = new Map();
    this.ladderPaths = new Map();
    this.mountainLadderCurves = new Map();
    this.mountainHazardCurves = new Map();
    this.torchLights = [];
    this.torchFlames = [];
    this.mountainLights = [];
    this.diceMeshes = [];
    this.confettiParticles = [];

    this.activeFollowObj = null;
    this.desiredTarget = new THREE.Vector3(0, 4.4, 0.5);
    this.desiredCameraPos = null;

    this.clock = new THREE.Clock();

    this.initRendererAndScene();
    this.initLights();

    this.classicGroup = new THREE.Group();
    this.mountainGroup = new THREE.Group();
    this.scene.add(this.classicGroup);
    this.scene.add(this.mountainGroup);

    this.buildEnvironment();
    this.buildBoard();
    this.buildLadders();
    this.buildSnakes();
    this.buildMysteryCrystals();
    this.buildMountainMode();
    this.buildDice();

    this.setBoardStyle(this.boardStyle);
    this.setTheme('day');

    this.handleResize = this.handleResize.bind(this);
    window.addEventListener('resize', this.handleResize);

    this.animate = this.animate.bind(this);
    this.animate();
  }

  initRendererAndScene() {
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color('#74ccf4');
    this.scene.fog = new THREE.FogExp2('#8cd9fa', 0.0095);

    const w = this.container.clientWidth || window.innerWidth;
    const h = this.container.clientHeight || window.innerHeight;

    this.camera = new THREE.PerspectiveCamera(46, w / h, 0.1, 260);
    this.camera.position.set(0, 22, 29);

    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    this.renderer.setSize(w, h);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;

    this.container.appendChild(this.renderer.domElement);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.075;
    this.controls.minDistance = 9;
    this.controls.maxDistance = 64;
    this.controls.maxPolarAngle = Math.PI / 2.15;
    this.controls.minPolarAngle = 0.12;
    this.controls.target.set(0, 2.0, 0);

    this.controls.addEventListener('start', () => {
      this.userDragging = true;
      this.desiredCameraPos = null;
    });
    this.controls.addEventListener('end', () => {
      this.userDragging = false;
    });
  }

  initLights() {
    this.hemiLight = new THREE.HemisphereLight('#ffffff', '#3a7d44', 0.85);
    this.scene.add(this.hemiLight);

    this.dirLight = new THREE.DirectionalLight('#fff5db', 1.55);
    this.dirLight.position.set(18, 30, 16);
    this.dirLight.castShadow = true;
    this.dirLight.shadow.mapSize.width = 2048;
    this.dirLight.shadow.mapSize.height = 2048;
    this.dirLight.shadow.camera.near = 2;
    this.dirLight.shadow.camera.far = 90;
    const d = 22;
    this.dirLight.shadow.camera.left = -d;
    this.dirLight.shadow.camera.right = d;
    this.dirLight.shadow.camera.top = d;
    this.dirLight.shadow.camera.bottom = -d;
    this.dirLight.shadow.bias = -0.0005;
    this.scene.add(this.dirLight);

    this.fillLight = new THREE.DirectionalLight('#a6d8ff', 0.45);
    this.fillLight.position.set(-16, 12, -14);
    this.scene.add(this.fillLight);
  }

  buildEnvironment() {
    // Lautan bergelombang
    const oceanGeo = new THREE.PlaneGeometry(220, 220, 42, 42);
    oceanGeo.rotateX(-Math.PI / 2);
    this.oceanBaseY = new Float32Array(oceanGeo.attributes.position.count);
    for (let i = 0; i < this.oceanBaseY.length; i++) {
      this.oceanBaseY[i] = oceanGeo.attributes.position.getY(i);
    }
    this.oceanMat = new THREE.MeshStandardMaterial({
      color: '#0e8dc7',
      roughness: 0.25,
      metalness: 0.15,
      flatShading: true
    });
    this.oceanMesh = new THREE.Mesh(oceanGeo, this.oceanMat);
    this.oceanMesh.position.y = -1.45;
    this.oceanMesh.receiveShadow = true;
    this.classicGroup.add(this.oceanMesh);

    // Pulau pasir & rumput tropis di bawah papan
    const sandIsland = new THREE.Mesh(
      new THREE.CylinderGeometry(19.5, 22.8, 1.5, 16),
      new THREE.MeshStandardMaterial({ color: '#f3d58d', roughness: 0.9, flatShading: true })
    );
    sandIsland.position.y = -1.35;
    sandIsland.receiveShadow = true;
    this.classicGroup.add(sandIsland);

    const grassBase = new THREE.Mesh(
      new THREE.BoxGeometry(25.8, 0.7, 25.8),
      new THREE.MeshStandardMaterial({ color: '#49a84d', roughness: 0.85, flatShading: true })
    );
    grassBase.position.y = -0.55;
    grassBase.receiveShadow = true;
    this.classicGroup.add(grassBase);

    // Dermaga kayu START di sebelah petak 1
    const startPos = BoardConfig.tileToClassicWorld(0);
    const dockGroup = new THREE.Group();
    const dockDeck = new THREE.Mesh(
      new THREE.BoxGeometry(3.4, 0.3, 3.4),
      new THREE.MeshStandardMaterial({ color: '#8d5524', roughness: 0.85 })
    );
    dockDeck.position.set(startPos.x, -0.22, startPos.z);
    dockDeck.receiveShadow = true;
    dockDeck.castShadow = true;
    dockGroup.add(dockDeck);

    // Tiang-tiang dermaga
    const postGeo = new THREE.CylinderGeometry(0.14, 0.16, 1.3, 8);
    const postMat = new THREE.MeshStandardMaterial({ color: '#5c3415', roughness: 0.9 });
    [
      [-1.4, -1.4],
      [1.4, -1.4],
      [-1.4, 1.4],
      [1.4, 1.4]
    ].forEach(([ox, oz]) => {
      const post = new THREE.Mesh(postGeo, postMat);
      post.position.set(startPos.x + ox, -0.65, startPos.z + oz);
      post.castShadow = true;
      dockGroup.add(post);
    });
    this.classicGroup.add(dockGroup);

    // Pohon Palem Tropis di sudut pulau
    const palmPositions = [
      [-15.5, -0.7, -14.5, 1.15],
      [15.8, -0.7, -14.2, 1.0],
      [-16.2, -0.7, 14.5, 0.95],
      [15.6, -0.7, 14.8, 1.1],
      [-17.2, -0.7, -1.5, 0.88],
      [16.8, -0.7, 2.2, 0.92],
      [2.0, -0.7, -16.5, 1.05],
      [-4.2, -0.7, 16.5, 0.85]
    ];
    palmPositions.forEach(([x, y, z, s], idx) => {
      const palm = this.createPalmTree(s, idx * 0.8);
      palm.position.set(x, y, z);
      this.classicGroup.add(palm);
    });

    // Batu karang hiasan di tepi pantai
    const rockMat = new THREE.MeshStandardMaterial({ color: '#7f8c8d', roughness: 0.9, flatShading: true });
    [
      [-14.2, -0.8, 9.5, 1.2],
      [14.5, -0.8, -8.5, 1.4],
      [10.5, -0.8, 15.8, 1.0],
      [-11.0, -0.8, -15.6, 1.3],
      [17.5, -1.0, -4.5, 0.9]
    ].forEach(([x, y, z, s], idx) => {
      const rock = new THREE.Mesh(new THREE.DodecahedronGeometry(0.9 * s, 0), rockMat);
      rock.position.set(x, y, z);
      rock.rotation.set(idx, idx * 1.3, 0);
      rock.scale.set(1.2, 0.75, 1.0);
      rock.castShadow = true;
      rock.receiveShadow = true;
      this.classicGroup.add(rock);
    });

    // Obor pulau untuk mode Malam
    const torchSpots = [
      [-13.5, -0.6, 13.5],
      [13.5, -0.6, 13.5],
      [-13.5, -0.6, -13.5],
      [13.5, -0.6, -13.5],
      [startPos.x - 1.6, -0.1, startPos.z + 1.6]
    ];
    torchSpots.forEach(([x, y, z]) => {
      const torch = this.createTorch(x, y, z);
      this.classicGroup.add(torch);
    });

    // Bintang untuk tema malam
    const starCount = 320;
    const starPositions = new Float32Array(starCount * 3);
    for (let i = 0; i < starCount; i++) {
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.random() * Math.PI * 0.42;
      const r = 85 + Math.random() * 25;
      starPositions[i * 3] = r * Math.sin(phi) * Math.cos(theta);
      starPositions[i * 3 + 1] = r * Math.cos(phi) + 10;
      starPositions[i * 3 + 2] = r * Math.sin(phi) * Math.sin(theta);
    }
    const starGeo = new THREE.BufferGeometry();
    starGeo.setAttribute('position', new THREE.BufferAttribute(starPositions, 3));
    this.starMat = new THREE.PointsMaterial({ color: '#ffffff', size: 0.7, transparent: true, opacity: 0 });
    this.starField = new THREE.Points(starGeo, this.starMat);
    this.scene.add(this.starField);
  }

  createPalmTree(scale = 1, rotY = 0) {
    const group = new THREE.Group();
    group.rotation.y = rotY;
    group.scale.setScalar(scale);

    const trunkMat = new THREE.MeshStandardMaterial({ color: '#8d5b34', roughness: 0.9, flatShading: true });
    let curY = 0;
    let curX = 0;
    for (let i = 0; i < 5; i++) {
      const seg = new THREE.Mesh(new THREE.CylinderGeometry(0.22 - i * 0.025, 0.28 - i * 0.025, 0.95, 7), trunkMat);
      curY += 0.82;
      curX += i * 0.14;
      seg.position.set(curX, curY - 0.4, 0);
      seg.rotation.z = -i * 0.07;
      seg.castShadow = true;
      group.add(seg);
    }

    const leafMat = new THREE.MeshStandardMaterial({
      color: '#2ecc71',
      roughness: 0.7,
      flatShading: true,
      side: THREE.DoubleSide
    });
    for (let i = 0; i < 6; i++) {
      const leaf = new THREE.Mesh(new THREE.ConeGeometry(0.42, 2.2, 4), leafMat);
      leaf.rotation.z = Math.PI / 2.3;
      const angle = (i / 6) * Math.PI * 2;
      const holder = new THREE.Group();
      holder.position.set(curX, curY + 0.1, 0);
      holder.rotation.y = angle;
      leaf.position.set(0.95, -0.15, 0);
      leaf.castShadow = true;
      holder.add(leaf);
      group.add(holder);
    }
    return group;
  }

  createTorch(x, y, z) {
    const group = new THREE.Group();
    group.position.set(x, y, z);

    const pole = new THREE.Mesh(
      new THREE.CylinderGeometry(0.11, 0.15, 2.5, 8),
      new THREE.MeshStandardMaterial({ color: '#4b3621', roughness: 0.9 })
    );
    pole.position.y = 1.25;
    pole.castShadow = true;
    group.add(pole);

    const cup = new THREE.Mesh(
      new THREE.CylinderGeometry(0.26, 0.14, 0.3, 8),
      new THREE.MeshStandardMaterial({ color: '#2d3436', metalness: 0.4, roughness: 0.6 })
    );
    cup.position.y = 2.55;
    group.add(cup);

    const flameMat = new THREE.MeshBasicMaterial({ color: '#ff9f1a' });
    const flame = new THREE.Mesh(new THREE.ConeGeometry(0.2, 0.48, 6), flameMat);
    flame.position.y = 2.9;
    flame.visible = false;
    group.add(flame);

    const light = new THREE.PointLight('#ff9f43', 0, 18, 1.5);
    light.position.y = 3.1;
    group.add(light);

    this.torchFlames.push(flame);
    this.torchLights.push(light);
    return group;
  }

  createTileTopTexture(tileNum, specialType) {
    const canvas = document.createElement('canvas');
    canvas.width = 160;
    canvas.height = 160;
    const ctx = canvas.getContext('2d');

    let bg = '#fef6d8';
    let border = '#e5cfa0';
    let textColor = '#3c2f1d';
    let badge = '';

    if (tileNum === 1) {
      bg = '#dcfce7';
      border = '#22c55e';
      textColor = '#14532d';
      badge = 'START';
    } else if (tileNum === 100) {
      bg = '#fef08a';
      border = '#eab308';
      textColor = '#854d0e';
      badge = '👑 FIN';
    } else if (specialType === 'ladder') {
      bg = '#d1fae5';
      border = '#10b981';
      textColor = '#065f46';
      badge = '▲';
    } else if (specialType === 'snake') {
      bg = '#ffe4e6';
      border = '#f43f5e';
      textColor = '#881337';
      badge = '▼';
    } else if (specialType === 'mystery') {
      bg = '#ede9fe';
      border = '#8b5cf6';
      textColor = '#4c1d95';
      badge = '?';
    } else {
      const palette = ['#fef9e7', '#f3f9d2', '#e8f8f5', '#fdf2e9'];
      bg = palette[(tileNum - 1) % palette.length];
    }

    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, 160, 160);

    ctx.strokeStyle = border;
    ctx.lineWidth = 10;
    ctx.strokeRect(5, 5, 150, 150);

    ctx.fillStyle = textColor;
    ctx.font = 'bold 54px system-ui, -apple-system, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(String(tileNum), 80, badge ? 66 : 82);

    if (badge) {
      ctx.font = 'bold 28px system-ui, -apple-system, sans-serif';
      ctx.fillText(badge, 80, 124);
    }

    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 4;
    return tex;
  }

  buildBoard() {
    const sideColors = ['#d8b982', '#c8a96e', '#b99b62', '#ad8f58'];
    const sideMats = sideColors.map(
      (c) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.88, flatShading: true })
    );

    const mysterySet = new Set(BoardConfig.MYSTERY_TILES);

    for (let tile = 1; tile <= 100; tile++) {
      const { row } = BoardConfig.tileToGrid(tile);
      const pos = BoardConfig.tileToClassicWorld(tile);

      // Kolom penyangga terasering sampai dasar pulau
      const pillarHeight = pos.y + 0.85;
      const pillarGeo = new THREE.BoxGeometry(BoardConfig.TILE_SIZE, pillarHeight, BoardConfig.TILE_SIZE);
      const pillarMat = sideMats[row % sideMats.length];
      const pillar = new THREE.Mesh(pillarGeo, pillarMat);
      pillar.position.set(pos.x, pos.y - pillarHeight / 2 - 0.08, pos.z);
      pillar.receiveShadow = true;
      pillar.castShadow = true;
      this.classicGroup.add(pillar);

      // Pelat permukaan bernomor di puncak blok
      let specialType = null;
      if (BoardConfig.LADDERS[tile]) specialType = 'ladder';
      else if (BoardConfig.SNAKES[tile]) specialType = 'snake';
      else if (mysterySet.has(tile)) specialType = 'mystery';

      const topTex = this.createTileTopTexture(tile, specialType);
      const topCapMat = new THREE.MeshStandardMaterial({ map: topTex, roughness: 0.6 });
      const capMaterials = [pillarMat, pillarMat, topCapMat, pillarMat, pillarMat, pillarMat];

      const cap = new THREE.Mesh(
        new THREE.BoxGeometry(BoardConfig.TILE_SIZE, 0.16, BoardConfig.TILE_SIZE),
        capMaterials
      );
      cap.position.set(pos.x, pos.y - 0.08, pos.z);
      cap.receiveShadow = true;
      cap.castShadow = true;
      this.classicGroup.add(cap);
    }

    // Kuil Mahkota di petak 100
    const p100 = BoardConfig.tileToClassicWorld(100);
    const crownGroup = new THREE.Group();
    crownGroup.position.set(p100.x, p100.y, p100.z);

    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(0.85, 0.09, 8, 24),
      new THREE.MeshStandardMaterial({ color: '#f1c40f', emissive: '#a37b00', emissiveIntensity: 0.35 })
    );
    ring.rotation.x = Math.PI / 2;
    ring.position.y = 0.08;
    crownGroup.add(ring);

    const crown = new THREE.Mesh(
      new THREE.OctahedronGeometry(0.45, 0),
      new THREE.MeshStandardMaterial({
        color: '#ffd700',
        emissive: '#f39c12',
        emissiveIntensity: 0.45,
        metalness: 0.6,
        roughness: 0.25
      })
    );
    crown.position.y = 2.45;
    crown.castShadow = true;
    crownGroup.add(crown);
    this.crownMesh = crown;
    this.classicGroup.add(crownGroup);
  }

  buildLadders() {
    const railMat = new THREE.MeshStandardMaterial({ color: '#b9772c', roughness: 0.65 });
    const rungMat = new THREE.MeshStandardMaterial({ color: '#e5a952', roughness: 0.6 });

    Object.entries(BoardConfig.LADDERS).forEach(([fromStr, toTile]) => {
      const fromTile = Number(fromStr);
      const a = BoardConfig.tileToClassicWorld(fromTile);
      const b = BoardConfig.tileToClassicWorld(toTile);

      const start = new THREE.Vector3(a.x, a.y + 0.14, a.z);
      const end = new THREE.Vector3(b.x, b.y + 0.14, b.z);
      this.ladderPaths.set(fromTile, { start: start.clone(), end: end.clone() });

      const dir = new THREE.Vector3().subVectors(end, start);
      const length = dir.length();
      const mid = new THREE.Vector3().addVectors(start, end).multiplyScalar(0.5);

      const upHint = new THREE.Vector3(0, 1, 0);
      const side = new THREE.Vector3().crossVectors(dir, upHint);
      if (side.lengthSq() < 0.001) side.set(1, 0, 0);
      side.normalize().multiplyScalar(0.36);

      const ladderGroup = new THREE.Group();

      // Dua tiang samping tangga
      [-1, 1].forEach((sign) => {
        const railGeo = new THREE.CylinderGeometry(0.08, 0.08, length, 8);
        const rail = new THREE.Mesh(railGeo, railMat);
        rail.position.copy(mid).addScaledVector(side, sign);
        rail.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.clone().normalize());
        rail.castShadow = true;
        ladderGroup.add(rail);
      });

      // Anak tangga
      const rungCount = Math.max(4, Math.floor(length / 0.72));
      const rungLength = 0.76;
      const rungDir = side.clone().normalize();
      for (let i = 1; i < rungCount; i++) {
        const t = i / rungCount;
        const p = new THREE.Vector3().lerpVectors(start, end, t);
        const rung = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.055, rungLength, 8), rungMat);
        rung.position.copy(p);
        rung.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), rungDir);
        rung.castShadow = true;
        ladderGroup.add(rung);
      }

      this.classicGroup.add(ladderGroup);
    });
  }

  createSnakeStripeTexture(primary, secondary) {
    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 64;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = primary;
    ctx.fillRect(0, 0, 256, 64);
    ctx.fillStyle = secondary;
    for (let x = 0; x < 256; x += 32) {
      ctx.fillRect(x, 0, 16, 64);
    }
    const tex = new THREE.CanvasTexture(canvas);
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(9, 1);
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  }

  buildSnakes() {
    const palettes = [
      ['#e74c3c', '#f1c40f'],
      ['#27ae60', '#a3e635'],
      ['#8e44ad', '#f472b6'],
      ['#e67e22', '#fef08a'],
      ['#0891b2', '#67e8f9'],
      ['#be123c', '#fda4af'],
      ['#16a34a', '#fde047'],
      ['#9333ea', '#fdba74']
    ];

    Object.entries(BoardConfig.SNAKES).forEach(([fromStr, toTile], idx) => {
      const fromTile = Number(fromStr);
      const a = BoardConfig.tileToClassicWorld(fromTile);
      const b = BoardConfig.tileToClassicWorld(toTile);

      const start = new THREE.Vector3(a.x, a.y + 0.35, a.z);
      const end = new THREE.Vector3(b.x, b.y + 0.25, b.z);

      const dir = new THREE.Vector3().subVectors(end, start);
      const horiz = new THREE.Vector3(dir.x, 0, dir.z);
      const perp = new THREE.Vector3(-horiz.z, 0, horiz.x);
      if (perp.lengthSq() < 0.001) perp.set(1, 0, 0);
      perp.normalize();

      const points = [];
      const segments = 6;
      for (let i = 0; i <= segments; i++) {
        const t = i / segments;
        const p = new THREE.Vector3().lerpVectors(start, end, t);
        const wave = Math.sin(t * Math.PI * 2.5) * (1.15 * Math.sin(t * Math.PI));
        p.addScaledVector(perp, wave);
        // Lengkungan ekstra di tengah agar tidak menembus terasering papan
        p.y += Math.sin(t * Math.PI) * 0.85;
        points.push(p);
      }

      const curve = new THREE.CatmullRomCurve3(points);
      this.snakeCurves.set(fromTile, curve);

      const [c1, c2] = palettes[idx % palettes.length];
      const tex = this.createSnakeStripeTexture(c1, c2);

      const tubeGeo = new THREE.TubeGeometry(curve, 48, 0.26, 10, false);
      const tubeMat = new THREE.MeshStandardMaterial({
        map: tex,
        roughness: 0.45,
        metalness: 0.08
      });
      const snakeMesh = new THREE.Mesh(tubeGeo, tubeMat);
      snakeMesh.castShadow = true;
      snakeMesh.receiveShadow = true;
      this.classicGroup.add(snakeMesh);

      // Kepala Ular di titik start
      const headGroup = new THREE.Group();
      headGroup.position.copy(start);
      const tangent = curve.getTangent(0.02);
      headGroup.lookAt(start.clone().add(tangent));

      const headMat = new THREE.MeshStandardMaterial({ color: c1, roughness: 0.4 });
      const head = new THREE.Mesh(new THREE.SphereGeometry(0.42, 12, 10), headMat);
      head.scale.set(1.05, 0.78, 1.35);
      head.castShadow = true;
      headGroup.add(head);

      // Mata putih + pupil hitam
      const eyeWhiteMat = new THREE.MeshBasicMaterial({ color: '#ffffff' });
      const pupilMat = new THREE.MeshBasicMaterial({ color: '#111111' });
      [-0.22, 0.22].forEach((ex) => {
        const ew = new THREE.Mesh(new THREE.SphereGeometry(0.11, 8, 8), eyeWhiteMat);
        ew.position.set(ex, 0.2, 0.26);
        headGroup.add(ew);

        const ep = new THREE.Mesh(new THREE.SphereGeometry(0.06, 8, 8), pupilMat);
        ep.position.set(ex, 0.22, 0.34);
        headGroup.add(ep);
      });

      // Lidah merah menjulur
      const tongue = new THREE.Mesh(
        new THREE.BoxGeometry(0.07, 0.03, 0.45),
        new THREE.MeshBasicMaterial({ color: '#ff3b5c' })
      );
      tongue.position.set(0, -0.05, 0.65);
      headGroup.add(tongue);

      this.classicGroup.add(headGroup);
    });
  }

  buildMysteryCrystals() {
    const mat = new THREE.MeshStandardMaterial({
      color: '#a855f7',
      emissive: '#7e22ce',
      emissiveIntensity: 0.5,
      metalness: 0.3,
      roughness: 0.2
    });
    const ringMat = new THREE.MeshBasicMaterial({ color: '#e9d5ff', transparent: true, opacity: 0.75 });

    BoardConfig.MYSTERY_TILES.forEach((tile, idx) => {
      const pos = BoardConfig.tileToClassicWorld(tile);
      const group = new THREE.Group();
      group.position.set(pos.x, pos.y + 0.68, pos.z);
      group.userData = { baseY: pos.y + 0.68, phase: idx * 0.9 };

      const crystal = new THREE.Mesh(new THREE.OctahedronGeometry(0.32, 0), mat);
      crystal.castShadow = true;
      group.add(crystal);

      const halo = new THREE.Mesh(new THREE.TorusGeometry(0.44, 0.035, 6, 18), ringMat);
      halo.rotation.x = Math.PI / 2;
      halo.position.y = -0.38;
      group.add(halo);

      this.mysteryMeshes.push(group);
      this.classicGroup.add(group);
    });
  }

  setMysteryVisible(visible) {
    this.mysteryMeshes.forEach((m) => {
      m.visible = visible;
    });
    this.mountainMysteryMeshes.forEach((m) => {
      m.visible = visible;
    });
  }

  createMountainBadgeTexture(tileNum) {
    const canvas = document.createElement('canvas');
    canvas.width = 96;
    canvas.height = 96;
    const ctx = canvas.getContext('2d');

    ctx.clearRect(0, 0, 96, 96);
    let fill = 'rgba(15, 23, 42, 0.72)';
    let stroke = '#e2e8f0';
    let text = '#ffffff';

    if (tileNum === 1) {
      fill = '#15803d';
      stroke = '#86efac';
    } else if (tileNum === 100) {
      fill = '#ca8a04';
      stroke = '#fef08a';
    } else if (BoardConfig.LADDERS[tileNum]) {
      fill = '#065f46';
      stroke = '#6ee7b7';
    } else if (BoardConfig.STREAMS[tileNum]) {
      fill = '#0369a1';
      stroke = '#7dd3fc';
    } else if (BoardConfig.LANDSLIDES[tileNum]) {
      fill = '#9a3412';
      stroke = '#fdba74';
    } else if (BoardConfig.MYSTERY_TILES.includes(tileNum)) {
      fill = '#6b21a8';
      stroke = '#d8b4fe';
    }

    ctx.beginPath();
    ctx.arc(48, 48, 43, 0, Math.PI * 2);
    ctx.fillStyle = fill;
    ctx.fill();
    ctx.lineWidth = 6;
    ctx.strokeStyle = stroke;
    ctx.stroke();

    ctx.fillStyle = text;
    ctx.font = 'bold 40px system-ui, -apple-system, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(String(tileNum), 48, 50);

    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  }

  prepareLoadedGltf(gltfScene) {
    gltfScene.traverse((child) => {
      if (child.isMesh) {
        child.castShadow = true;
        child.receiveShadow = true;
        if (child.geometry?.attributes?.color && child.material) {
          child.material.vertexColors = true;
          child.material.needsUpdate = true;
        }
      }
    });
    return gltfScene;
  }

  buildMountainMode() {
    // Alas lembah hijau luas di sekitar kaki gunung
    this.valleyMat = new THREE.MeshStandardMaterial({
      color: '#46883f',
      roughness: 0.94,
      flatShading: true
    });
    const valleyFloor = new THREE.Mesh(new THREE.CircleGeometry(110, 32), this.valleyMat);
    valleyFloor.rotation.x = -Math.PI / 2;
    valleyFloor.position.y = -0.35;
    valleyFloor.receiveShadow = true;
    this.mountainGroup.add(valleyFloor);

    // Pelat batu pendaratan dadu di lembah depan tengah
    const dicePad = new THREE.Mesh(
      new THREE.CylinderGeometry(2.35, 2.7, 0.34, 10),
      new THREE.MeshStandardMaterial({ color: '#8f969c', roughness: 0.88, flatShading: true })
    );
    dicePad.position.set(0, 0.25, 14.8);
    dicePad.receiveShadow = true;
    dicePad.castShadow = true;
    this.mountainGroup.add(dicePad);

    // Plat nomor 1-100 di atas batu pijakan jalan setapak gunung
    const discGeo = new THREE.CircleGeometry(0.28, 12);
    for (let tile = 1; tile <= 100; tile++) {
      const pos = BoardConfig.tileToMountainWorld(tile);
      const tex = this.createMountainBadgeTexture(tile);
      const discMat = new THREE.MeshBasicMaterial({ map: tex, transparent: true });
      const disc = new THREE.Mesh(discGeo, discMat);
      disc.rotation.x = -Math.PI / 2;
      disc.position.set(pos.x, pos.y + 0.02, pos.z);
      this.mountainGroup.add(disc);
    }

    // Kurva panjat tangga & meluncur sungai/longsor yang presisi mengikuti lereng gunung
    Object.entries(BoardConfig.LADDERS).forEach(([fromStr, toTile]) => {
      const fromTile = Number(fromStr);
      const p0 = BoardConfig.tileToMountainWorld(fromTile);
      const p1 = BoardConfig.tileToMountainWorld(toTile);
      const fromRow = Math.floor((fromTile - 1) / 10);
      const toRow = Math.floor((toTile - 1) / 10);
      const archOut = 0.35 + Math.abs(toRow - fromRow) * 0.28;

      const pts = [];
      for (let i = 0; i <= 6; i++) {
        const t = i / 6;
        const pt = new THREE.Vector3(
          THREE.MathUtils.lerp(p0.x, p1.x, t),
          THREE.MathUtils.lerp(p0.y, p1.y, t) + Math.sin(t * Math.PI) * 0.45,
          THREE.MathUtils.lerp(p0.z, p1.z, t) + Math.sin(t * Math.PI) * archOut * 0.85
        );
        pts.push(pt);
      }
      this.mountainLadderCurves.set(fromTile, new THREE.CatmullRomCurve3(pts));
    });

    Object.entries(BoardConfig.SNAKES).forEach(([fromStr, toTile], idx) => {
      const fromTile = Number(fromStr);
      const p0 = BoardConfig.tileToMountainWorld(fromTile);
      const p1 = BoardConfig.tileToMountainWorld(toTile);
      const isStream = Boolean(BoardConfig.STREAMS[fromTile]);
      const streamIdx = Object.keys(BoardConfig.STREAMS).map(Number).indexOf(fromTile);
      const slideIdx = Object.keys(BoardConfig.LANDSLIDES).map(Number).indexOf(fromTile);
      const fromRow = Math.floor((fromTile - 1) / 10);
      const toRow = Math.floor((toTile - 1) / 10);
      const rowSpan = Math.abs(fromRow - toRow);

      // Hitung vektor tegak lurus di bidang horizontal (Blender XY -> Three XZ)
      const dx = p1.x - p0.x;
      const dz = p1.z - p0.z;
      const perp = new THREE.Vector3(dz, 0, -dx);
      if (perp.lengthSq() < 0.001) perp.set(1, 0, 0);
      perp.normalize();

      const pts = [];
      for (let i = 0; i <= 8; i++) {
        const t = i / 8;
        const swirl = isStream
          ? Math.sin(t * Math.PI * 2.2 + Math.max(0, streamIdx)) * 0.65 * Math.sin(t * Math.PI)
          : Math.sin(t * Math.PI * 1.8 - Math.max(0, slideIdx)) * 0.55 * Math.sin(t * Math.PI);

        const pt = new THREE.Vector3(
          THREE.MathUtils.lerp(p0.x, p1.x, t) + perp.x * swirl,
          THREE.MathUtils.lerp(p0.y, p1.y, t) + Math.sin(t * Math.PI) * 0.65 + 0.16,
          THREE.MathUtils.lerp(p0.z, p1.z, t) + perp.z * swirl + Math.sin(t * Math.PI) * (0.35 + rowSpan * 0.25)
        );
        pts.push(pt);
      }
      this.mountainHazardCurves.set(fromTile, new THREE.CatmullRomCurve3(pts));
    });

    // Lampu Mode Malam untuk Api Unggun Basecamp & 8 Lentera Jalur
    const campLight = new THREE.PointLight('#ff9f43', 0, 14, 1.4);
    campLight.position.set(-11.7, 1.5, 14.3);
    this.mountainGroup.add(campLight);
    this.mountainLights.push(campLight);

    [0, 10, 21, 40, 51, 70, 81, 91].forEach((lt) => {
      const tp = BoardConfig.tileToMountainWorld(lt);
      const outDir = tp.x >= 0 ? 0.95 : -0.95;
      const lLight = new THREE.PointLight('#fbbf24', 0, 9.5, 1.6);
      lLight.position.set(tp.x + outDir, tp.y + 1.0, tp.z + 0.42);
      this.mountainGroup.add(lLight);
      this.mountainLights.push(lLight);
    });

    // Muat aset GLB Blender (gunung + jalur + hutan + basecamp + puncak + peti mystery)
    const loader = new GLTFLoader();
    loader.load('./assets/models/mountain_trail.glb', (gltf) => {
      this.mountainGroup.add(this.prepareLoadedGltf(gltf.scene));
    });
    loader.load('./assets/models/mountain_scenery.glb', (gltf) => {
      this.mountainGroup.add(this.prepareLoadedGltf(gltf.scene));
    });
    loader.load('./assets/models/summit_set.glb', (gltf) => {
      const root = this.prepareLoadedGltf(gltf.scene);
      const crateTemplate = root.getObjectByName('MysterySupplyCrate');
      const crystalTemplate = root.getObjectByName('MysteryCrystal');

      BoardConfig.MYSTERY_TILES.forEach((tile, idx) => {
        const pos = BoardConfig.tileToMountainWorld(tile);
        const wrapper = new THREE.Group();
        wrapper.position.set(pos.x, pos.y + 0.02, pos.z);

        if (crateTemplate) {
          const crate = crateTemplate.clone();
          crate.position.set(0.56, -0.05, 0.2);
          crate.scale.setScalar(0.65);
          wrapper.add(crate);
        }

        const floatGroup = new THREE.Group();
        floatGroup.position.set(0, 0.65, 0);
        floatGroup.userData = { baseY: 0.65, phase: idx * 0.9 };
        if (crystalTemplate) {
          const cry = crystalTemplate.clone();
          cry.position.set(0, -0.8, 0);
          cry.scale.setScalar(1.05);
          floatGroup.add(cry);
        }
        wrapper.add(floatGroup);
        this.mountainMysteryMeshes.push(wrapper);
        this.mountainGroup.add(wrapper);
      });
    });
  }

  createDieFaceTexture(value) {
    const canvas = document.createElement('canvas');
    canvas.width = 160;
    canvas.height = 160;
    const ctx = canvas.getContext('2d');

    ctx.fillStyle = '#fffdf7';
    ctx.fillRect(0, 0, 160, 160);
    ctx.strokeStyle = '#d6cfc2';
    ctx.lineWidth = 10;
    ctx.strokeRect(5, 5, 150, 150);

    const pips = {
      1: [[80, 80]],
      2: [
        [45, 45],
        [115, 115]
      ],
      3: [
        [45, 45],
        [80, 80],
        [115, 115]
      ],
      4: [
        [45, 45],
        [115, 45],
        [45, 115],
        [115, 115]
      ],
      5: [
        [45, 45],
        [115, 45],
        [80, 80],
        [45, 115],
        [115, 115]
      ],
      6: [
        [45, 40],
        [115, 40],
        [45, 80],
        [115, 80],
        [45, 120],
        [115, 120]
      ]
    };

    ctx.fillStyle = value === 1 || value === 6 ? '#e11d48' : '#1e293b';
    const radius = value === 1 ? 20 : 14;
    pips[value].forEach(([px, py]) => {
      ctx.beginPath();
      ctx.arc(px, py, radius, 0, Math.PI * 2);
      ctx.fill();
    });

    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  }

  buildDice() {
    // BoxGeometry face order: +X(3), -X(4), +Y(1), -Y(6), +Z(2), -Z(5)
    const faceOrder = [3, 4, 1, 6, 2, 5];
    const materials = faceOrder.map(
      (v) =>
        new THREE.MeshStandardMaterial({
          map: this.createDieFaceTexture(v),
          roughness: 0.35,
          metalness: 0.05
        })
    );

    for (let i = 0; i < 2; i++) {
      const die = new THREE.Mesh(new THREE.BoxGeometry(1.15, 1.15, 1.15), materials);
      die.rotation.order = 'YXZ';
      die.castShadow = true;
      die.receiveShadow = true;
      die.visible = false;
      this.diceMeshes.push(die);
      this.scene.add(die);
    }
  }

  async throwDice(diceValues) {
    const count = diceValues.length;
    const isMountain = this.boardStyle === 'mountain';
    const baseY = isMountain ? 0.42 + 0.575 : 4 * BoardConfig.ROW_HEIGHT + 0.575;
    const landingZ = isMountain ? 14.8 : 0.5 * BoardConfig.STEP_PITCH;

    const anims = diceValues.map((val, idx) => {
      const die = this.diceMeshes[idx];
      die.visible = true;
      const targetX = count === 1 ? 0 : idx === 0 ? -1.1 : 1.1;
      const startX = targetX + (idx === 0 ? -3.2 : 3.2);
      const startZ = landingZ + 7.5;

      const faceRot = DICE_FACE_ROTATIONS[val] || DICE_FACE_ROTATIONS[1];
      const targetRotX = faceRot.x + Math.PI * 4;
      const targetRotZ = faceRot.z + Math.PI * 2;
      const targetRotY = (Math.random() - 0.5) * 1.2;

      return {
        die,
        startX,
        startZ,
        targetX,
        targetZ: landingZ,
        targetRotX,
        targetRotY,
        targetRotZ
      };
    });

    if (count === 1 && this.diceMeshes[1]) {
      this.diceMeshes[1].visible = false;
    }

    // Arahkan fokus sementara ke area dadu jika autoFollow aktif
    if (this.autoFollow && !this.userDragging) {
      this.desiredTarget.set(0, baseY + 0.5, landingZ);
    }

    const duration = 1050;
    const startTime = performance.now();

    await new Promise((resolve) => {
      const tick = (now) => {
        const rawT = Math.min(1, (now - startTime) / duration);
        const moveT = easeOutCubic(rawT);

        // Tiga pantulan parabolik yang makin mengecil
        let bounceY = 0;
        if (rawT < 0.55) {
          const u = rawT / 0.55;
          bounceY = Math.sin(u * Math.PI) * 5.2;
        } else if (rawT < 0.82) {
          const u = (rawT - 0.55) / 0.27;
          bounceY = Math.sin(u * Math.PI) * 1.9;
        } else {
          const u = (rawT - 0.82) / 0.18;
          bounceY = Math.sin(u * Math.PI) * 0.55;
        }

        anims.forEach((a) => {
          a.die.position.x = THREE.MathUtils.lerp(a.startX, a.targetX, moveT);
          a.die.position.z = THREE.MathUtils.lerp(a.startZ, a.targetZ, moveT);
          a.die.position.y = baseY + bounceY;

          const spinFactor = 1 - easeOutCubic(rawT);
          a.die.rotation.x = a.targetRotX - spinFactor * Math.PI * 4;
          a.die.rotation.z = a.targetRotZ - spinFactor * Math.PI * 3;
          a.die.rotation.y = a.targetRotY - spinFactor * 2.5;
        });

        if (rawT < 1) {
          requestAnimationFrame(tick);
        } else {
          resolve();
        }
      };
      requestAnimationFrame(tick);
    });
  }

  createPawnMesh(characterId, playerIndex) {
    const charInfo =
      BoardConfig.CHARACTERS.find((c) => c.id === characterId) || BoardConfig.CHARACTERS[0];

    const root = new THREE.Group();
    const mainMat = new THREE.MeshStandardMaterial({ color: charInfo.color, roughness: 0.45 });
    const accentMat = new THREE.MeshStandardMaterial({ color: charInfo.accent, roughness: 0.35 });
    const skinMat = new THREE.MeshStandardMaterial({ color: '#ffdfc4', roughness: 0.65 });
    const darkMat = new THREE.MeshStandardMaterial({ color: '#1e272e', roughness: 0.5 });

    // Alas pion
    const base = new THREE.Mesh(new THREE.CylinderGeometry(0.45, 0.52, 0.16, 16), accentMat);
    base.position.y = 0.08;
    base.castShadow = true;
    root.add(base);

    // Cincin giliran aktif di bawah pion
    const activeRing = new THREE.Mesh(
      new THREE.RingGeometry(0.56, 0.72, 24),
      new THREE.MeshBasicMaterial({ color: '#fef08a', side: THREE.DoubleSide, transparent: true, opacity: 0.9 })
    );
    activeRing.rotation.x = -Math.PI / 2;
    activeRing.position.y = 0.04;
    activeRing.visible = false;
    root.add(activeRing);
    root.userData.activeRing = activeRing;

    // Tubuh utama
    const body = new THREE.Mesh(new THREE.CylinderGeometry(0.24, 0.36, 0.75, 12), mainMat);
    body.position.y = 0.52;
    body.castShadow = true;
    root.add(body);

    // Kepala
    const head = new THREE.Mesh(
      new THREE.SphereGeometry(0.28, 12, 12),
      characterId === 'mecha' || characterId === 'neko' ? mainMat : skinMat
    );
    head.position.y = 1.08;
    head.castShadow = true;
    root.add(head);

    // Mata sederhana
    const eyeMat = new THREE.MeshBasicMaterial({ color: '#111827' });
    [-0.1, 0.1].forEach((ex) => {
      const eye = new THREE.Mesh(new THREE.SphereGeometry(0.042, 6, 6), eyeMat);
      eye.position.set(ex, 1.1, 0.25);
      root.add(eye);
    });

    // Detail spesifik tiap karakter
    if (characterId === 'explorer') {
      const brim = new THREE.Mesh(new THREE.CylinderGeometry(0.46, 0.46, 0.06, 14), accentMat);
      brim.position.y = 1.28;
      root.add(brim);
      const crown = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.26, 0.24, 12), mainMat);
      crown.position.y = 1.42;
      root.add(crown);
      const pack = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.42, 0.22), accentMat);
      pack.position.set(0, 0.62, -0.32);
      root.add(pack);
    } else if (characterId === 'knight') {
      const helm = new THREE.Mesh(new THREE.SphereGeometry(0.31, 12, 10, 0, Math.PI * 2, 0, Math.PI * 0.65), accentMat);
      helm.position.y = 1.11;
      root.add(helm);
      const plume = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.26, 0.34), mainMat);
      plume.position.set(0, 1.46, -0.02);
      root.add(plume);
      const shield = new THREE.Mesh(new THREE.CylinderGeometry(0.24, 0.16, 0.08, 6), accentMat);
      shield.rotation.z = Math.PI / 2;
      shield.position.set(-0.36, 0.62, 0.08);
      root.add(shield);
    } else if (characterId === 'mecha') {
      const visor = new THREE.Mesh(
        new THREE.BoxGeometry(0.36, 0.11, 0.12),
        new THREE.MeshBasicMaterial({ color: '#38bdf8' })
      );
      visor.position.set(0, 1.1, 0.24);
      root.add(visor);
      const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 0.28, 6), darkMat);
      stem.position.y = 1.46;
      root.add(stem);
      const bulb = new THREE.Mesh(
        new THREE.SphereGeometry(0.07, 8, 8),
        new THREE.MeshBasicMaterial({ color: '#ef4444' })
      );
      bulb.position.y = 1.62;
      root.add(bulb);
    } else if (characterId === 'neko') {
      [-0.17, 0.17].forEach((ex, idx) => {
        const ear = new THREE.Mesh(new THREE.ConeGeometry(0.11, 0.24, 4), mainMat);
        ear.position.set(ex, 1.38, 0);
        ear.rotation.z = idx === 0 ? 0.25 : -0.25;
        root.add(ear);
      });
      const tail = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, 0.5, 6), accentMat);
      tail.position.set(0, 0.45, -0.35);
      tail.rotation.x = -0.8;
      root.add(tail);
    }

    // Aura Tameng Anti-Ular
    const shieldAura = new THREE.Mesh(
      new THREE.SphereGeometry(0.75, 16, 12),
      new THREE.MeshBasicMaterial({
        color: '#22d3ee',
        transparent: true,
        opacity: 0.28,
        wireframe: true
      })
    );
    shieldAura.position.y = 0.78;
    shieldAura.visible = false;
    root.add(shieldAura);
    root.userData.shieldAura = shieldAura;
    root.userData.slotIndex = playerIndex;

    return root;
  }

  getSlotOffset(slotIndex, totalSameTile, isStartDock = false) {
    if (totalSameTile <= 1) return { x: 0, z: 0 };
    const isMountain = this.boardStyle === 'mountain';
    const dx = isStartDock ? (isMountain ? 0.65 : 0.85) : (isMountain ? 0.28 : 0.45);
    const dz = isStartDock ? (isMountain ? 0.65 : 0.85) : (isMountain ? 0.22 : 0.42);
    const offsets = [
      { x: -dx, z: -dz },
      { x: dx, z: -dz },
      { x: -dx, z: dz },
      { x: dx, z: dz }
    ];
    return offsets[slotIndex % offsets.length];
  }

  getPawnWorldPos(tile, playerId) {
    const base = BoardConfig.tileToWorld(tile, this.boardStyle);
    const sameTilePlayers = [];
    this.pawnMeta.forEach((meta, pid) => {
      if (meta.tile === tile) sameTilePlayers.push(pid);
    });
    const idx = Math.max(0, sameTilePlayers.indexOf(playerId));
    const offset = this.getSlotOffset(idx, sameTilePlayers.length, tile <= 0);
    return new THREE.Vector3(base.x + offset.x, base.y + 0.02, base.z + offset.z);
  }

  syncPlayers(players, activePlayerId, snapPositions = true) {
    const activeIds = new Set(players.map((p) => p.id));

    // Hapus pion yang sudah keluar
    for (const [pid, mesh] of this.pawns.entries()) {
      if (!activeIds.has(pid)) {
        this.scene.remove(mesh);
        this.pawns.delete(pid);
        this.pawnMeta.delete(pid);
        const el = this.overlayEls.get(pid);
        if (el) {
          el.remove();
          this.overlayEls.delete(pid);
        }
      }
    }

    players.forEach((p, idx) => {
      let mesh = this.pawns.get(p.id);
      if (!mesh || mesh.userData.characterId !== p.characterId) {
        if (mesh) this.scene.remove(mesh);
        mesh = this.createPawnMesh(p.characterId, idx);
        mesh.userData.characterId = p.characterId;
        this.pawns.set(p.id, mesh);
        this.scene.add(mesh);
      }

      this.pawnMeta.set(p.id, {
        name: p.name,
        characterId: p.characterId,
        tile: p.tile,
        shield: Boolean(p.shield),
        isActive: p.id === activePlayerId
      });

      mesh.userData.activeRing.visible = p.id === activePlayerId;
      mesh.userData.shieldAura.visible = Boolean(p.shield);

      this.ensureOverlayElement(p.id, p, p.id === activePlayerId);
    });

    if (snapPositions) {
      players.forEach((p) => {
        const mesh = this.pawns.get(p.id);
        if (mesh) {
          mesh.position.copy(this.getPawnWorldPos(p.tile, p.id));
        }
      });
    }
  }

  ensureOverlayElement(playerId, player, isActive) {
    let el = this.overlayEls.get(playerId);
    const charInfo =
      BoardConfig.CHARACTERS.find((c) => c.id === player.characterId) || BoardConfig.CHARACTERS[0];

    if (!el) {
      el = document.createElement('div');
      el.className = 'pawn-overlay';
      el.innerHTML = `
        <div class="pawn-emote hidden"></div>
        <div class="pawn-tag">
          <span class="pawn-dot" style="background:${charInfo.color}"></span>
          <span class="pawn-name"></span>
          <span class="pawn-shield hidden">🛡️</span>
        </div>
      `;
      this.overlayLayer.appendChild(el);
      this.overlayEls.set(playerId, el);
    }

    const tag = el.querySelector('.pawn-tag');
    tag.classList.toggle('active', Boolean(isActive));
    el.querySelector('.pawn-name').textContent = player.name;
    el.querySelector('.pawn-shield').classList.toggle('hidden', !player.shield);
  }

  showEmote(playerId, emoji, label) {
    const el = this.overlayEls.get(playerId);
    if (!el) return;
    const emoteEl = el.querySelector('.pawn-emote');
    emoteEl.textContent = `${emoji} ${label}`;
    emoteEl.classList.remove('hidden');
    emoteEl.classList.remove('pop');
    void emoteEl.offsetWidth;
    emoteEl.classList.add('pop');

    if (this.emoteTimeouts.has(playerId)) {
      clearTimeout(this.emoteTimeouts.get(playerId));
    }
    const timer = setTimeout(() => {
      emoteEl.classList.add('hidden');
    }, 2400);
    this.emoteTimeouts.set(playerId, timer);
  }

  setActiveFollow(playerId) {
    this.activeFollowObj = playerId ? this.pawns.get(playerId) || null : null;
  }

  async animateHopPath(playerId, pathTiles, onEachStep) {
    const mesh = this.pawns.get(playerId);
    if (!mesh || !pathTiles.length) return;
    this.setActiveFollow(playerId);

    for (let i = 0; i < pathTiles.length; i++) {
      const nextTile = pathTiles[i];
      const meta = this.pawnMeta.get(playerId);
      if (meta) meta.tile = nextTile;

      const startPos = mesh.position.clone();
      const endPos = this.getPawnWorldPos(nextTile, playerId);

      // Hadapkan pion ke arah gerak
      const dx = endPos.x - startPos.x;
      const dz = endPos.z - startPos.z;
      if (Math.hypot(dx, dz) > 0.05) {
        mesh.rotation.y = Math.atan2(dx, dz);
      }

      if (typeof onEachStep === 'function') onEachStep(nextTile, i);

      const dur = 225;
      const t0 = performance.now();
      await new Promise((resolve) => {
        const frame = (now) => {
          const t = Math.min(1, (now - t0) / dur);
          mesh.position.lerpVectors(startPos, endPos, easeInOutQuad(t));
          mesh.position.y += Math.sin(t * Math.PI) * 0.9;
          if (t < 1) requestAnimationFrame(frame);
          else resolve();
        };
        requestAnimationFrame(frame);
      });
    }
    this.repositionAllPawnsSmooth();
  }

  async animateLadderClimb(playerId, fromTile, toTile) {
    const mesh = this.pawns.get(playerId);
    if (!mesh) return;
    this.setActiveFollow(playerId);

    const isMountain = this.boardStyle === 'mountain';
    const mountainCurve = isMountain ? this.mountainLadderCurves.get(fromTile) : null;
    const ladder = !isMountain ? this.ladderPaths.get(fromTile) : null;
    const meta = this.pawnMeta.get(playerId);
    if (meta) meta.tile = toTile;

    const startPos = ladder ? ladder.start.clone() : mesh.position.clone();
    const endPos = this.getPawnWorldPos(toTile, playerId);

    const dx = endPos.x - startPos.x;
    const dz = endPos.z - startPos.z;
    if (Math.hypot(dx, dz) > 0.05) {
      mesh.rotation.y = Math.atan2(dx, dz);
    }

    const dur = 1050;
    const t0 = performance.now();
    await new Promise((resolve) => {
      const frame = (now) => {
        const t = Math.min(1, (now - t0) / dur);
        const eased = easeInOutQuad(t);
        if (mountainCurve) {
          const p = mountainCurve.getPointAt(eased);
          mesh.position.copy(p);
        } else {
          mesh.position.lerpVectors(startPos, endPos, eased);
        }
        // Gerak kiri-kanan kecil seakan memanjat anak tangga
        mesh.rotation.z = Math.sin(t * Math.PI * 8) * 0.12;
        if (t < 1) requestAnimationFrame(frame);
        else {
          mesh.rotation.z = 0;
          mesh.position.copy(endPos);
          resolve();
        }
      };
      requestAnimationFrame(frame);
    });
    this.repositionAllPawnsSmooth();
  }

  async animateSnakeSlide(playerId, fromTile, toTile) {
    const mesh = this.pawns.get(playerId);
    if (!mesh) return;
    this.setActiveFollow(playerId);

    const curve =
      this.boardStyle === 'mountain'
        ? this.mountainHazardCurves.get(fromTile)
        : this.snakeCurves.get(fromTile);
    const meta = this.pawnMeta.get(playerId);
    if (meta) meta.tile = toTile;
    const finalPos = this.getPawnWorldPos(toTile, playerId);

    const dur = 1200;
    const t0 = performance.now();
    await new Promise((resolve) => {
      const frame = (now) => {
        const t = Math.min(1, (now - t0) / dur);
        const eased = easeInOutQuad(t);
        if (curve) {
          const p = curve.getPointAt(eased);
          mesh.position.copy(p);
          mesh.position.y += 0.25;
          const tangent = curve.getTangentAt(Math.min(0.99, eased));
          mesh.rotation.y = Math.atan2(tangent.x, tangent.z);
          mesh.rotation.z = Math.sin(t * Math.PI * 6) * 0.18;
        } else {
          mesh.position.lerp(finalPos, eased);
        }
        if (t < 1) requestAnimationFrame(frame);
        else {
          mesh.rotation.z = 0;
          mesh.position.copy(finalPos);
          resolve();
        }
      };
      requestAnimationFrame(frame);
    });
    this.repositionAllPawnsSmooth();
  }

  repositionAllPawnsSmooth() {
    this.pawnMeta.forEach((meta, pid) => {
      const mesh = this.pawns.get(pid);
      if (mesh) {
        mesh.position.copy(this.getPawnWorldPos(meta.tile, pid));
      }
    });
  }

  updatePlayerShield(playerId, hasShield) {
    const meta = this.pawnMeta.get(playerId);
    if (meta) meta.shield = Boolean(hasShield);
    const mesh = this.pawns.get(playerId);
    if (mesh) mesh.userData.shieldAura.visible = Boolean(hasShield);
    const el = this.overlayEls.get(playerId);
    if (el) el.querySelector('.pawn-shield').classList.toggle('hidden', !hasShield);
  }

  spawnWinConfetti(tile = 100) {
    const origin = BoardConfig.tileToWorld(tile, this.boardStyle);
    const colors = ['#ff5e57', '#ffd32a', '#0be881', '#00d8d6', '#a55eea'];
    for (let i = 0; i < 65; i++) {
      const geo = new THREE.BoxGeometry(0.18, 0.18, 0.05);
      const mat = new THREE.MeshBasicMaterial({ color: colors[i % colors.length] });
      const p = new THREE.Mesh(geo, mat);
      p.position.set(origin.x, origin.y + 1.4, origin.z);
      p.userData = {
        vx: (Math.random() - 0.5) * 0.22,
        vy: 0.18 + Math.random() * 0.25,
        vz: (Math.random() - 0.5) * 0.22,
        rx: (Math.random() - 0.5) * 0.25,
        ry: (Math.random() - 0.5) * 0.25,
        life: 0
      };
      this.confettiParticles.push(p);
      this.scene.add(p);
    }
  }

  setTheme(mode) {
    this.theme = mode === 'night' ? 'night' : 'day';
    const isNight = this.theme === 'night';

    if (isNight) {
      this.scene.background = new THREE.Color('#090f24');
      this.scene.fog = new THREE.FogExp2('#0d1633', 0.011);
      this.hemiLight.color.set('#4c6ef5');
      this.hemiLight.groundColor.set('#142038');
      this.hemiLight.intensity = 0.55;
      this.dirLight.color.set('#9bbcff');
      this.dirLight.intensity = 0.65;
      this.fillLight.intensity = 0.25;
      this.oceanMat.color.set('#072b4d');
      if (this.valleyMat) this.valleyMat.color.set('#1a3324');
      this.starMat.opacity = 0.9;
    } else {
      this.scene.background = new THREE.Color('#74ccf4');
      this.scene.fog = new THREE.FogExp2('#8cd9fa', 0.0085);
      this.hemiLight.color.set('#ffffff');
      this.hemiLight.groundColor.set('#3a7d44');
      this.hemiLight.intensity = 0.88;
      this.dirLight.color.set('#fff5db');
      this.dirLight.intensity = 1.55;
      this.fillLight.intensity = 0.45;
      this.oceanMat.color.set('#0e8dc7');
      if (this.valleyMat) this.valleyMat.color.set('#46883f');
      this.starMat.opacity = 0;
    }

    this.torchFlames.forEach((f) => {
      f.visible = isNight;
    });
    this.torchLights.forEach((l) => {
      l.intensity = isNight ? 2.8 : 0;
    });
    this.mountainLights.forEach((l, idx) => {
      l.intensity = isNight ? (idx === 0 ? 4.2 : 3.0) : 0;
    });
  }

  setBoardStyle(style) {
    this.boardStyle = style === 'classic' ? 'classic' : 'mountain';
    const isMountain = this.boardStyle === 'mountain';
    this.classicGroup.visible = !isMountain;
    this.mountainGroup.visible = isMountain;
    this.diceMeshes.forEach((d) => {
      d.visible = false;
    });
    this.repositionAllPawnsSmooth();
    this.setCameraPreset('overview');
  }

  setAutoFollow(enabled) {
    this.autoFollow = Boolean(enabled);
  }

  setCameraPreset(preset, activePlayerId = null) {
    this.cameraPresetLockUntil = performance.now() + 1200;
    const isMountain = this.boardStyle === 'mountain';
    if (preset === 'overview') {
      if (isMountain) {
        this.desiredTarget.set(0, 4.4, 0.5);
        this.desiredCameraPos = new THREE.Vector3(0, 21.0, 36.5);
      } else {
        this.desiredTarget.set(0, 2.1, 0);
        this.desiredCameraPos = new THREE.Vector3(0, 22, 29);
      }
    } else if (preset === 'top') {
      if (isMountain) {
        this.desiredTarget.set(0, 4.0, 0.5);
        this.desiredCameraPos = new THREE.Vector3(0, 38.5, 11.0);
      } else {
        this.desiredTarget.set(0, 1.8, 0);
        this.desiredCameraPos = new THREE.Vector3(0, 35, 5.5);
      }
    } else if (preset === 'follow') {
      const pawn = activePlayerId ? this.pawns.get(activePlayerId) : null;
      const focus = pawn
        ? pawn.position.clone()
        : new THREE.Vector3(0, isMountain ? 4.2 : 2, 0);
      this.desiredTarget.copy(focus).add(new THREE.Vector3(0, 0.85, 0));
      this.desiredCameraPos = focus.clone().add(new THREE.Vector3(0, 7.8, 11.8));
    }
  }

  updateOverlays() {
    const w = this.container.clientWidth || window.innerWidth;
    const h = this.container.clientHeight || window.innerHeight;
    const proj = new THREE.Vector3();

    this.pawns.forEach((mesh, pid) => {
      const el = this.overlayEls.get(pid);
      if (!el) return;
      const meta = this.pawnMeta.get(pid);
      let extraY = 0;
      if (meta) {
        let sameCount = 0;
        let idx = 0;
        this.pawnMeta.forEach((m, otherId) => {
          if (m.tile === meta.tile) {
            if (otherId === pid) idx = sameCount;
            sameCount++;
          }
        });
        if (sameCount > 1) {
          extraY = (idx % 2) * 0.34;
        }
      }
      proj.copy(mesh.position);
      proj.y += 1.75 + extraY;
      proj.project(this.camera);

      if (proj.z > 1) {
        el.style.opacity = '0';
        return;
      }
      el.style.opacity = '1';
      const x = (proj.x * 0.5 + 0.5) * w;
      const y = (-proj.y * 0.5 + 0.5) * h;
      el.style.transform = `translate3d(${x}px, ${y}px, 0) translate(-50%, -100%)`;
    });
  }

  handleResize() {
    if (!this.container) return;
    const w = this.container.clientWidth || window.innerWidth;
    const h = this.container.clientHeight || window.innerHeight;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
  }

  animate() {
    requestAnimationFrame(this.animate);
    const t = this.clock.getElapsedTime();

    // Gelombang laut halus (hanya saat mode klasik terlihat)
    if (this.classicGroup.visible) {
      const posAttr = this.oceanMesh.geometry.attributes.position;
      for (let i = 0; i < posAttr.count; i++) {
        const vx = posAttr.getX(i);
        const vz = posAttr.getZ(i);
        const wave = Math.sin(vx * 0.14 + t * 1.4) * 0.18 + Math.cos(vz * 0.12 + t * 1.1) * 0.16;
        posAttr.setY(i, this.oceanBaseY[i] + wave);
      }
      posAttr.needsUpdate = true;
    }

    // Animasi Kristal Mystery & Mahkota Puncak
    this.mysteryMeshes.forEach((m) => {
      if (!m.visible) return;
      m.rotation.y = t * 1.6 + m.userData.phase;
      m.position.y = m.userData.baseY + Math.sin(t * 2.8 + m.userData.phase) * 0.12;
    });
    this.mountainMysteryMeshes.forEach((wrapper) => {
      if (!wrapper.visible || wrapper.children.length < 2) return;
      const floatGrp = wrapper.children[1];
      floatGrp.rotation.y = t * 1.6 + floatGrp.userData.phase;
      floatGrp.position.y = floatGrp.userData.baseY + Math.sin(t * 2.8 + floatGrp.userData.phase) * 0.10;
    });
    if (this.crownMesh) {
      this.crownMesh.rotation.y = t * 1.2;
      this.crownMesh.position.y = 2.4 + Math.sin(t * 2.2) * 0.15;
    }

    // Kedip cahaya obor / api unggun saat malam
    if (this.theme === 'night') {
      this.torchLights.forEach((light, i) => {
        light.intensity = 2.6 + Math.sin(t * 11 + i * 2) * 0.45;
      });
      if (this.mountainLights.length > 0) {
        this.mountainLights[0].intensity = 4.2 + Math.sin(t * 12) * 0.75;
      }
    }

    // Update partikel confetti kemenangan
    for (let i = this.confettiParticles.length - 1; i >= 0; i--) {
      const p = this.confettiParticles[i];
      p.position.x += p.userData.vx;
      p.position.y += p.userData.vy;
      p.position.z += p.userData.vz;
      p.userData.vy -= 0.0065;
      p.rotation.x += p.userData.rx;
      p.rotation.y += p.userData.ry;
      p.userData.life += 1;
      if (p.userData.life > 190 || p.position.y < -3) {
        this.scene.remove(p);
        this.confettiParticles.splice(i, 1);
      }
    }

    // Auto-follow pion atau preset kamera halus
    const now = performance.now();
    if (!this.userDragging) {
      if (this.desiredCameraPos) {
        this.camera.position.lerp(this.desiredCameraPos, 0.08);
        this.controls.target.lerp(this.desiredTarget, 0.09);
        if (this.camera.position.distanceTo(this.desiredCameraPos) < 0.25) {
          this.desiredCameraPos = null;
        }
      } else if (this.autoFollow && this.activeFollowObj && now > this.cameraPresetLockUntil) {
        const focus = this.activeFollowObj.position;
        this.desiredTarget.lerp(new THREE.Vector3(focus.x, focus.y + 0.8, focus.z), 0.12);
        this.controls.target.lerp(this.desiredTarget, 0.1);
      }
    }

    this.controls.update();
    this.renderer.render(this.scene, this.camera);
    this.updateOverlays();
  }
}
