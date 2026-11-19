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
    this.cameraMode = 'overview'; // 'overview' | 'tpp' | 'fpp' | 'top'
    this.hikerTemplate = null;
    this.autoFollow = true;
    this.userDragging = false;
    this.povDragging = false;
    this.lastPointer = { x: 0, y: 0 };
    this.fppYawOffset = 0;
    this.fppPitchOffset = 0;
    this.climbOrSlidePitch = 0;
    this.isPawnMoving = false;
    this.activePlayerId = null;
    this.cameraPresetLockUntil = 0;
    this.tppRaycaster = new THREE.Raycaster();
    this.tppColliders = [];
    this.mountainTreeMeshes = [];
    this._treeWorldPos = new THREE.Vector3();
    this.wildernessGroup = null;
    this.wildernessTreesGroup = null;
    this.wildernessZoneGroups = [];
    this.wildernessZoneFireflies = [];
    this.wildernessLights = [];
    this.wildernessBlend = 0;

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
    this.mountainLadderYaws = new Map();
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

    const dom = this.renderer.domElement;
    dom.addEventListener('pointerdown', (e) => {
      if (this.cameraMode === 'fpp' || this.cameraMode === 'tpp') {
        this.povDragging = true;
        this.lastPointer = { x: e.clientX, y: e.clientY };
      }
    });
    window.addEventListener('pointermove', (e) => {
      if (!this.povDragging || (this.cameraMode !== 'fpp' && this.cameraMode !== 'tpp')) return;
      const dx = e.clientX - this.lastPointer.x;
      const dy = e.clientY - this.lastPointer.y;
      this.lastPointer = { x: e.clientX, y: e.clientY };
      this.fppYawOffset = THREE.MathUtils.clamp(this.fppYawOffset - dx * 0.006, -1.65, 1.65);
      this.fppPitchOffset = THREE.MathUtils.clamp(this.fppPitchOffset - dy * 0.005, -0.65, 0.75);
    });
    window.addEventListener('pointerup', () => {
      this.povDragging = false;
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

      // Portal Seluncuran Rintangan di titik start
      const portalGroup = new THREE.Group();
      portalGroup.position.copy(start);
      const tangent = curve.getTangent(0.02);
      portalGroup.lookAt(start.clone().add(tangent));

      const ringMat = new THREE.MeshStandardMaterial({
        color: c1,
        emissive: c1,
        emissiveIntensity: 0.35,
        metalness: 0.4,
        roughness: 0.25
      });
      const portalRing = new THREE.Mesh(new THREE.TorusGeometry(0.46, 0.08, 10, 24), ringMat);
      portalRing.castShadow = true;
      portalGroup.add(portalRing);

      const portalDisc = new THREE.Mesh(
        new THREE.CylinderGeometry(0.38, 0.38, 0.05, 20),
        new THREE.MeshBasicMaterial({ color: c2, transparent: true, opacity: 0.65 })
      );
      portalDisc.rotation.x = Math.PI / 2;
      portalGroup.add(portalDisc);

      this.classicGroup.add(portalGroup);
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

  registerTppColliders(gltfScene) {
    gltfScene.traverse((child) => {
      if (child.isMesh) {
        const mats = Array.isArray(child.material) ? child.material : [child.material];
        mats.forEach((m) => {
          if (m) m.side = THREE.DoubleSide;
        });
        this.tppColliders.push(child);
      }
    });
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

    // Kurva panjat tangga 1:1 mengikuti posisi anak tangga tinggi di cliff_ladders.glb
    const MOUNTAIN_LADDER_DATA = {
      4: {
        yaw: 2.63338,
        points: [
          [-3.4, 0.9907, 12.8944],
          [-3.365, 0.9863, 12.5841],
          [-3.1376, 2.5088, 12.1758],
          [-2.9213, 3.2361, 11.7876],
          [-2.7008, 3.9761, 11.3918],
          [-2.413, 4.2896, 10.875],
          [-2.1956, 4.2787, 10.4848],
          [-1.975, 4.2674, 10.0887],
          [-1.7122, 4.0345, 9.617],
          [-1.496, 3.6966, 9.2287],
          [-1.2797, 3.3587, 8.8405],
          [-1.0634, 3.0208, 8.4522],
          [-0.9956, 2.9176, 8.0829]
        ]
      },
      13: {
        yaw: -2.40431,
        points: [
          [5.3222, 1.8238, 10.3144],
          [5.271, 1.8215, 9.9956],
          [4.8552, 4.3127, 9.5377],
          [4.3561, 5.3418, 8.9882],
          [3.9436, 5.4904, 8.5339],
          [3.531, 5.6391, 8.0796],
          [3.1185, 5.7878, 7.6254],
          [2.6864, 5.8902, 7.1495],
          [2.2692, 5.9231, 6.6902],
          [1.8043, 5.8811, 6.1782],
          [1.3677, 5.4047, 5.6975],
          [0.9552, 4.9489, 5.2432],
          [0.8578, 4.8444, 4.8736]
        ]
      },
      33: {
        yaw: 2.63495,
        points: [
          [4.6333, 3.6638, 6.2101],
          [4.6824, 3.7506, 5.8547],
          [4.7973, 3.989, 5.6477],
          [4.9122, 4.2273, 5.4406],
          [5.0271, 4.4657, 5.2335],
          [5.142, 4.704, 5.0265],
          [5.2569, 4.9424, 4.8194],
          [5.3902, 5.2098, 4.5793],
          [5.539, 5.2633, 4.3112],
          [5.6644, 5.2767, 4.0851],
          [5.7794, 5.2745, 3.878],
          [5.9137, 5.2402, 3.6359],
          [6.0044, 5.1051, 3.2054]
        ]
      },
      42: {
        yaw: 2.36112,
        points: [
          [-6.0044, 4.4969, 3.3437],
          [-5.9626, 4.4753, 3.0212],
          [-5.7431, 6.2584, 2.7995],
          [-5.5362, 6.8478, 2.5906],
          [-5.3293, 7.4371, 2.3817],
          [-5.0981, 8.0638, 2.1481],
          [-4.8022, 8.1217, 1.8493],
          [-4.5953, 8.1217, 1.6404],
          [-4.3822, 8.1142, 1.4252],
          [-4.1163, 8.0742, 1.1566],
          [-3.8542, 7.3501, 0.8919],
          [-3.6473, 6.4391, 0.683],
          [-3.6, 6.4238, 0.355]
        ]
      },
      50: {
        yaw: -2.29451,
        points: [
          [7.72, 5.192, 2.9817],
          [7.6755, 5.1718, 2.6546],
          [7.4238, 6.955, 2.4322],
          [7.1583, 7.3942, 2.1975],
          [6.8566, 7.4897, 1.931],
          [6.6186, 7.5048, 1.7207],
          [6.3849, 7.5178, 1.5141],
          [6.1526, 7.529, 1.3089],
          [5.9154, 7.5347, 1.0993],
          [5.6154, 7.4205, 0.8342],
          [5.3831, 7.2407, 0.6289],
          [5.1509, 7.0608, 0.4237],
          [5.04, 6.9451, 0.0379]
        ]
      },
      62: {
        yaw: -3.08062,
        points: [
          [-5.04, 6.3369, -0.3897],
          [-5.0422, 6.3103, -0.6903],
          [-5.06, 8.7572, -0.9812],
          [-5.0779, 9.753, -1.2747],
          [-5.1048, 10.0327, -1.7161],
          [-5.1222, 10.0439, -2.0007],
          [-5.1397, 10.054, -2.2868],
          [-5.157, 10.0627, -2.5714],
          [-5.1779, 10.0638, -2.9135],
          [-5.2022, 9.5397, -3.3119],
          [-5.2197, 8.8273, -3.5974],
          [-5.237, 8.1171, -3.8819],
          [-5.24, 8.09, -4.195]
        ]
      },
      74: {
        yaw: 2.7702,
        points: [
          [1.9533, 7.4307, -1.8735],
          [1.9739, 7.4085, -2.1789],
          [2.1239, 10.2291, -2.5642],
          [2.33, 10.7996, -3.0932],
          [2.477, 10.8164, -3.4708],
          [2.6241, 10.8309, -3.8484],
          [2.8087, 10.6793, -4.3225],
          [2.9557, 10.4175, -4.6998],
          [3.1026, 10.1558, -5.077],
          [3.2495, 9.8941, -5.4542],
          [3.4033, 9.6136, -5.8491],
          [3.5548, 9.1818, -6.2382],
          [3.5933, 9.0969, -6.5897]
        ]
      },
      84: {
        yaw: 3.00148,
        points: [
          [-1.7467, 8.3507, -4.205],
          [-1.7466, 8.3388, -4.5083],
          [-1.7294, 8.8711, -4.6304],
          [-1.7137, 9.1476, -4.7416],
          [-1.698, 9.4241, -4.8528],
          [-1.6823, 9.7005, -4.964],
          [-1.6597, 10.0458, -5.1242],
          [-1.6126, 9.9701, -5.458],
          [-1.597, 9.8865, -5.5692],
          [-1.5813, 9.8029, -5.6804],
          [-1.5656, 9.7193, -5.7916],
          [-1.5499, 9.6357, -5.9028],
          [-1.54, 9.5313, -6.2757]
        ]
      }
    };

    Object.entries(MOUNTAIN_LADDER_DATA).forEach(([fromStr, data]) => {
      const fromTile = Number(fromStr);
      const pts = data.points.map(([x, y, z]) => new THREE.Vector3(x, y, z));
      this.mountainLadderCurves.set(fromTile, new THREE.CatmullRomCurve3(pts));
      this.mountainLadderYaws.set(fromTile, data.yaw);
    });

    // Kurva hanyut sungai 1:1 mengikuti permukaan air mountain_streams.glb
    const MOUNTAIN_STREAM_DATA = {
      27: [
        [2.9867, 3.0913, 8.6382],
        [2.8608, 3.0813, 9.0982],
        [2.7551, 3.057, 9.2442],
        [2.6191, 3.0179, 9.3605],
        [2.4872, 2.1609, 9.4411],
        [2.3525, 1.9041, 9.5166],
        [2.2194, 1.8492, 9.621],
        [2.1073, 1.8445, 9.7798],
        [2.1104, 1.8441, 10.0282],
        [2.1999, 1.8441, 10.2526],
        [2.3276, 1.8442, 10.43],
        [2.1384, 1.8459, 10.6071],
        [1.9214, 1.8541, 10.7485],
        [1.6754, 1.9338, 10.8476],
        [1.4008, 1.9316, 10.9454],
        [1.1605, 1.8909, 11.084],
        [0.9834, 1.7849, 11.2322],
        [0.8043, 1.2778, 11.3982],
        [0.6013, 1.1256, 11.5801],
        [0.3692, 1.1087, 11.7597],
        [0.1197, 1.099, 11.9197],
        [-0.1257, 1.091, 12.0539],
        [-0.3508, 1.0828, 12.1654],
        [-0.5595, 1.073, 12.256],
        [-0.7722, 1.0691, 12.3274],
        [-1.0075, 1.0676, 12.3922],
        [-1.1333, 1.0776, 12.8522]
      ],
      40: [
        [-8.34, 4.272, 5.4844],
        [-8.2743, 4.262, 5.9444],
        [-8.0329, 4.2297, 6.1907],
        [-7.974, 4.2099, 6.4066],
        [-7.9489, 3.4812, 6.5861],
        [-7.9129, 2.6868, 6.8002],
        [-7.8401, 2.5134, 7.0272],
        [-7.7823, 2.5052, 7.2806],
        [-7.9264, 2.5035, 7.5672],
        [-8.2106, 2.5038, 7.7892],
        [-8.0894, 2.5085, 8.1087],
        [-7.8314, 2.5847, 8.3802],
        [-7.5671, 2.6127, 8.6584],
        [-7.2601, 2.6215, 8.8682],
        [-6.9366, 2.3927, 9.057],
        [-6.6456, 2.2979, 9.2979],
        [-6.3919, 2.2017, 9.5692],
        [-6.1542, 2.1935, 9.8552],
        [-6.3489, 2.1917, 10.1123],
        [-6.5553, 2.1935, 10.3971],
        [-6.4856, 2.2017, 10.6978],
        [-6.3397, 2.2517, 10.9365],
        [-6.2131, 2.2247, 11.1823],
        [-6.1036, 1.1646, 11.4604],
        [-5.9541, 0.8778, 11.7358],
        [-5.7324, 0.8938, 11.844],
        [-5.6667, 0.9038, 12.304]
      ],
      66: [
        [0.72, 6.6844, 0.0016],
        [0.6631, 6.6744, 0.4616],
        [0.5821, 6.641, 0.6231],
        [0.4468, 6.6255, 0.7779],
        [0.3208, 6.6171, 0.9714],
        [0.2262, 6.6081, 1.1841],
        [0.1601, 6.5738, 1.382],
        [0.1031, 6.0124, 1.5291],
        [0.0703, 5.7924, 1.6346],
        [0.0512, 5.7153, 1.785],
        [0.0013, 5.671, 1.9579],
        [-0.0647, 5.6161, 2.1307],
        [-0.1167, 5.6114, 2.3126],
        [-0.1029, 5.611, 2.5077],
        [0.0018, 5.611, 2.6662],
        [0.1021, 5.611, 2.8336],
        [0.1244, 5.6114, 3.0252],
        [0.0465, 5.6161, 3.1897],
        [-0.0523, 5.671, 3.3343],
        [-0.1706, 5.704, 3.463],
        [-0.3215, 5.7042, 3.5819],
        [-0.4934, 5.6766, 3.7333],
        [-0.6262, 4.9549, 3.9277],
        [-0.715, 4.7427, 4.0717],
        [-0.7994, 4.7322, 4.1574],
        [-0.8009, 4.7476, 4.2753],
        [-0.8578, 4.7576, 4.7353]
      ],
      89: [
        [4.0756, 8.7851, -4.1945],
        [4.0715, 8.7751, -3.7345],
        [3.8993, 8.73, -3.464],
        [3.8966, 8.7198, -3.2371],
        [3.8728, 8.7418, -3.0758],
        [3.8745, 8.7793, -2.9288],
        [3.8982, 8.1782, -2.7585],
        [3.8904, 7.4313, -2.5581],
        [3.853, 7.2003, -2.3559],
        [3.8299, 7.1921, -2.1393],
        [3.8575, 7.1904, -1.8862],
        [3.9177, 7.1904, -1.6409],
        [3.9557, 7.1921, -1.3668],
        [4.0554, 7.2003, -1.1234],
        [4.1738, 7.2659, -0.9001],
        [4.2772, 6.9172, -0.6706],
        [4.3664, 6.7967, -0.4263],
        [4.3458, 6.7921, -0.1525],
        [4.319, 6.7917, 0.1148],
        [4.3033, 6.7921, 0.3725],
        [4.2465, 6.7967, 0.5409],
        [4.1806, 6.8517, 0.6679],
        [4.1227, 6.855, 0.7888],
        [4.0872, 5.7844, 0.9174],
        [4.0569, 5.4937, 1.0743],
        [3.9485, 5.4938, 1.1352],
        [3.9444, 5.5038, 1.5952]
      ]
    };

    // Kurva luncuran longsor 1:1 mengikuti alur tanah/batu mountain_landslides.glb
    const MOUNTAIN_LANDSLIDE_DATA = {
      43: [
        [-4.2889, 4.5838, 3.5995],
        [-4.3125, 4.5638, 4.0595],
        [-4.1111, 4.5565, 4.3224],
        [-3.9161, 4.5753, 4.6107],
        [-3.8127, 4.3325, 4.9083],
        [-3.746, 4.0298, 5.2067],
        [-3.6428, 4.0298, 5.5167],
        [-3.7073, 4.0298, 5.8412],
        [-3.7201, 4.0298, 6.1532],
        [-3.7652, 4.0298, 6.4323],
        [-3.8197, 3.982, 6.6868],
        [-3.9246, 3.8976, 6.9322],
        [-3.9871, 3.0486, 7.197],
        [-3.985, 2.7799, 7.4398],
        [-4.0067, 2.7622, 7.7023],
        [-4.0175, 2.7622, 8.0114],
        [-3.9068, 2.7622, 8.3003],
        [-3.9467, 2.7622, 8.6047],
        [-4.1594, 2.7343, 8.8597],
        [-4.3681, 2.6825, 9.1176],
        [-4.5551, 2.5132, 9.415],
        [-4.7784, 2.2535, 9.7067],
        [-5.0171, 2.202, 9.9813],
        [-5.2986, 2.2382, 10.0585],
        [-5.3222, 2.2582, 10.5185]
      ],
      54: [
        [2.3667, 5.5907, 1.9478],
        [2.5129, 5.5707, 2.4078],
        [2.8464, 5.5289, 2.6025],
        [3.1396, 5.5168, 2.6235],
        [3.445, 5.5174, 2.6343],
        [3.7747, 5.5237, 2.6483],
        [4.1222, 5.3146, 2.6827],
        [4.427, 5.0561, 2.7873],
        [4.692, 5.0184, 2.9282],
        [4.9895, 5.0367, 3.0418],
        [5.2373, 5.0367, 3.2264],
        [5.1431, 5.0367, 3.5234],
        [5.0439, 5.0367, 3.7917],
        [5.3172, 5.0367, 3.8989],
        [5.6041, 5.0327, 3.9448],
        [5.8906, 5.0423, 4.0219],
        [6.2129, 5.0859, 4.1319],
        [6.5614, 4.4479, 4.1727],
        [6.854, 3.6686, 4.1843],
        [7.1181, 3.4957, 4.1868],
        [7.3692, 3.4673, 4.1728],
        [7.6267, 3.4539, 4.1394],
        [7.9065, 3.4519, 4.0948],
        [8.1937, 3.47, 4.1356],
        [8.34, 3.49, 4.5956]
      ],
      76: [
        [-0.6511, 7.6044, -2.0622],
        [-0.7532, 7.5844, -1.6022],
        [-1.0845, 7.5851, -1.5105],
        [-1.2569, 7.5964, -1.3172],
        [-1.4044, 7.6073, -1.1958],
        [-1.53, 7.6129, -1.0947],
        [-1.6356, 7.6241, -0.9763],
        [-1.7396, 7.6093, -0.8238],
        [-1.8653, 7.5647, -0.6411],
        [-2.0258, 7.0949, -0.4479],
        [-2.2125, 6.5771, -0.2939],
        [-2.3674, 6.4584, -0.2028],
        [-2.5287, 6.4406, -0.1272],
        [-2.6979, 6.4422, -0.0095],
        [-2.8499, 6.4422, 0.1401],
        [-2.9641, 6.4422, 0.3254],
        [-2.88, 6.4422, 0.5065],
        [-2.877, 6.4422, 0.7318],
        [-2.9654, 6.4422, 0.9313],
        [-3.1326, 6.4422, 1.0558],
        [-3.3272, 6.3976, 1.1331],
        [-3.5529, 6.3811, 1.1981],
        [-3.7775, 6.0015, 1.2984],
        [-3.8424, 5.9182, 1.4541],
        [-3.9444, 5.9382, 1.9141]
      ],
      99: [
        [-3.5933, 9.7051, -6.1896],
        [-3.6574, 9.6851, -5.7296],
        [-3.9049, 9.7364, -5.4307],
        [-4.1736, 9.9021, -5.1289],
        [-4.3492, 8.5279, -4.7833],
        [-4.5313, 8.1084, -4.4226],
        [-4.6763, 8.1084, -3.9559],
        [-4.8286, 8.1084, -3.4224],
        [-4.9334, 7.8836, -2.8895],
        [-5.1545, 7.8836, -2.3906],
        [-5.4269, 7.8836, -1.9686],
        [-5.4772, 7.8637, -1.705],
        [-5.4879, 7.0309, -1.4769],
        [-5.5367, 6.2684, -1.2426],
        [-5.7013, 6.2684, -0.8649],
        [-5.9632, 6.2684, -0.3844],
        [-6.0277, 6.173, 0.1658],
        [-6.2255, 6.0436, 0.6809],
        [-6.2924, 6.0436, 1.1996],
        [-6.507, 6.0436, 1.6067],
        [-6.817, 6.0677, 1.8933],
        [-7.1765, 5.3773, 2.1492],
        [-7.5099, 4.5434, 2.439],
        [-7.656, 4.39, 2.7983],
        [-7.72, 4.41, 3.2583]
      ]
    };

    Object.entries(BoardConfig.SNAKES).forEach(([fromStr, toTile]) => {
      const fromTile = Number(fromStr);
      const rawPts = MOUNTAIN_STREAM_DATA[fromTile] || MOUNTAIN_LANDSLIDE_DATA[fromTile];
      if (rawPts) {
        const sPts = rawPts.map(([x, y, z]) => new THREE.Vector3(x, y, z));
        this.mountainHazardCurves.set(fromTile, new THREE.CatmullRomCurve3(sPts));
      }
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

    // Muat aset GLB Blender (gunung + jalur + tangga tebing + hutan + basecamp + puncak + peti mystery)
    const loader = new GLTFLoader();
    loader.load('./assets/models/mountain_trail.glb', (gltf) => {
      const root = this.prepareLoadedGltf(gltf.scene);
      this.registerTppColliders(root);
      this.mountainGroup.add(root);
    });
    loader.load('./assets/models/cliff_ladders.glb', (gltf) => {
      this.mountainGroup.add(this.prepareLoadedGltf(gltf.scene));
    });
    loader.load('./assets/models/mountain_streams.glb', (gltf) => {
      this.mountainGroup.add(this.prepareLoadedGltf(gltf.scene));
    });
    loader.load('./assets/models/mountain_landslides.glb', (gltf) => {
      this.mountainGroup.add(this.prepareLoadedGltf(gltf.scene));
    });
    loader.load('./assets/models/mountain_scenery.glb', (gltf) => {
      const root = this.prepareLoadedGltf(gltf.scene);
      root.traverse((child) => {
        if (child.isMesh && (child.name.includes('Tree') || child.parent?.name?.includes('Tree'))) {
          this.mountainTreeMeshes.push(child);
        }
      });
      this.mountainGroup.add(root);
    });

    // Grup Hutan Belantara & Kantong Teduh (hanya aktif di TPP/FPP; jamur & kunang hanya di zona aktif)
    this.wildernessGroup = new THREE.Group();
    this.wildernessGroup.visible = false;
    this.mountainGroup.add(this.wildernessGroup);

    this.wildernessTreesGroup = new THREE.Group();
    this.wildernessTreesGroup.visible = false;
    this.wildernessGroup.add(this.wildernessTreesGroup);

    this.wildernessZoneGroups = [0, 1, 2].map(() => {
      const zg = new THREE.Group();
      zg.visible = false;
      this.wildernessGroup.add(zg);
      return zg;
    });
    this.wildernessLights = [];
    this.wildernessZoneFireflies = [];

    loader.load('./assets/models/wilderness_forest.glb', (gltf) => {
      const wfRoot = this.prepareLoadedGltf(gltf.scene);
      [...wfRoot.children].forEach((child) => {
        const name = child.name || '';
        if (name.startsWith('WildernessTree_')) {
          this.wildernessTreesGroup.add(child);
          return;
        }
        const match = /_z([012])_/.exec(name);
        const zIdx = match ? Number(match[1]) : 0;
        const targetGroup = this.wildernessZoneGroups[zIdx] || this.wildernessZoneGroups[0];
        targetGroup.add(child);
      });
    });

    [18, 47, 65].forEach((wt, zIdx) => {
      const wp = BoardConfig.tileToMountainWorld(wt);
      const wLight = new THREE.PointLight('#2dd4bf', 0, 9.5, 1.4);
      wLight.position.set(wp.x, wp.y + 1.85, wp.z);
      this.wildernessZoneGroups[zIdx].add(wLight);
      this.wildernessLights.push(wLight);
    });

    BoardConfig.WILDERNESS_ZONES.forEach(([zStart, zEnd], zIdx) => {
      const count = 30;
      const fireflyPositions = new Float32Array(count * 3);
      const baseY = [];
      for (let i = 0; i < count; i++) {
        const tileSample = zStart + Math.floor(i * ((zEnd - zStart + 1) / count));
        const tp = BoardConfig.tileToMountainWorld(tileSample);
        const fx = tp.x + (Math.random() - 0.5) * 3.0;
        const fy = tp.y + 0.8 + Math.random() * 2.0;
        const fz = tp.z + (Math.random() - 0.5) * 2.4;
        fireflyPositions[i * 3] = fx;
        fireflyPositions[i * 3 + 1] = fy;
        fireflyPositions[i * 3 + 2] = fz;
        baseY.push(fy);
      }
      const flyGeo = new THREE.BufferGeometry();
      flyGeo.setAttribute('position', new THREE.BufferAttribute(fireflyPositions, 3));
      const flyMat = new THREE.PointsMaterial({
        color: '#5eead4',
        size: 0.16,
        transparent: true,
        opacity: 0,
        blending: THREE.AdditiveBlending,
        depthWrite: false
      });
      const points = new THREE.Points(flyGeo, flyMat);
      this.wildernessZoneGroups[zIdx].add(points);
      this.wildernessZoneFireflies.push({ points, mat: flyMat, baseY });
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

    loader.load('./assets/models/hiker_human.glb', (gltf) => {
      this.hikerTemplate = this.prepareLoadedGltf(gltf.scene);
      this.upgradePawnsWithHikerModel();
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

    // Arahkan fokus sementara ke area dadu jika autoFollow aktif (kecuali saat POV TPP/FPP)
    if (this.autoFollow && !this.userDragging && this.cameraMode !== 'fpp' && this.cameraMode !== 'tpp') {
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

  tintHikerMaterial(mat, charInfo) {
    const cloned = mat.clone();
    if (mat.name === 'JacketMat') {
      cloned.color.set(charInfo.color);
    } else if (mat.name === 'AccentMat') {
      cloned.color.set(charInfo.accent);
    }
    return cloned;
  }

  populatePawnVisual(root, characterId) {
    const holder = root.userData.visualHolder;
    if (!holder) return;
    while (holder.children.length > 0) {
      holder.remove(holder.children[0]);
    }

    const charInfo =
      BoardConfig.CHARACTERS.find((c) => c.id === characterId) || BoardConfig.CHARACTERS[0];

    if (this.hikerTemplate) {
      const clone = this.hikerTemplate.clone(true);
      clone.scale.setScalar(0.92);
      clone.traverse((child) => {
        if (child.isMesh) {
          child.castShadow = true;
          child.receiveShadow = true;
          if (Array.isArray(child.material)) {
            child.material = child.material.map((m) => this.tintHikerMaterial(m, charInfo));
          } else if (child.material) {
            child.material = this.tintHikerMaterial(child.material, charInfo);
          }
        }
      });

      ['explorer', 'knight', 'mecha', 'neko'].forEach((cid) => {
        const hat = clone.getObjectByName(`Hat_${cid}`);
        if (hat) hat.visible = cid === characterId;
      });

      holder.add(clone);
      root.userData.rig = {
        bodyGroup: clone,
        armL: clone.getObjectByName('ArmL'),
        armR: clone.getObjectByName('ArmR'),
        legL: clone.getObjectByName('LegL'),
        legR: clone.getObjectByName('LegR'),
        head: clone.getObjectByName('HikerHead')
      };
      return;
    }

    // Fallback manusia low-poly sementara sebelum GLB selesai dimuat
    const fallbackGroup = new THREE.Group();
    const mainMat = new THREE.MeshStandardMaterial({ color: charInfo.color, roughness: 0.55 });
    const accentMat = new THREE.MeshStandardMaterial({ color: charInfo.accent, roughness: 0.45 });
    const pantsMat = new THREE.MeshStandardMaterial({ color: '#334155', roughness: 0.8 });
    const skinMat = new THREE.MeshStandardMaterial({ color: '#f5cba7', roughness: 0.68 });

    const torso = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.46, 0.22), mainMat);
    torso.position.y = 0.82;
    torso.castShadow = true;
    fallbackGroup.add(torso);

    const head = new THREE.Mesh(new THREE.SphereGeometry(0.15, 10, 10), skinMat);
    head.position.y = 1.24;
    head.castShadow = true;
    fallbackGroup.add(head);

    const hat = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.22, 0.14, 10), accentMat);
    hat.position.y = 1.38;
    fallbackGroup.add(hat);

    const makeLimb = (w, h, d, mat, x, y) => {
      const piv = new THREE.Group();
      piv.position.set(x, y, 0);
      const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
      m.position.y = -h / 2;
      m.castShadow = true;
      piv.add(m);
      fallbackGroup.add(piv);
      return piv;
    };

    const armL = makeLimb(0.1, 0.42, 0.1, mainMat, 0.23, 1.02);
    const armR = makeLimb(0.1, 0.42, 0.1, mainMat, -0.23, 1.02);
    const legL = makeLimb(0.12, 0.54, 0.14, pantsMat, 0.1, 0.58);
    const legR = makeLimb(0.12, 0.54, 0.14, pantsMat, -0.1, 0.58);

    holder.add(fallbackGroup);
    root.userData.rig = { bodyGroup: fallbackGroup, armL, armR, legL, legR, head };
  }

  upgradePawnsWithHikerModel() {
    this.pawns.forEach((mesh, pid) => {
      const meta = this.pawnMeta.get(pid);
      const charId = meta ? meta.characterId : mesh.userData.characterId;
      this.populatePawnVisual(mesh, charId || 'explorer');
    });
  }

  applyPawnRigPose(mesh, pose = {}) {
    const rig = mesh?.userData?.rig;
    if (!rig) return;

    const legSwing = pose.legSwing || 0;
    const armSwing = pose.armSwing || 0;
    const armRaise = pose.armRaise || 0;
    const torsoLean = pose.torsoLean || 0;
    const bobY = pose.bobY || 0;
    const climbPhase = pose.climbPhase ?? null;

    if (rig.bodyGroup) {
      rig.bodyGroup.position.y = bobY;
      rig.bodyGroup.rotation.x = torsoLean;
    }

    if (climbPhase !== null) {
      if (rig.armL) rig.armL.rotation.x = -1.75 + Math.sin(climbPhase) * 0.65;
      if (rig.armR) rig.armR.rotation.x = -1.75 - Math.sin(climbPhase) * 0.65;
      if (rig.legL) rig.legL.rotation.x = -0.35 - Math.sin(climbPhase) * 0.55;
      if (rig.legR) rig.legR.rotation.x = -0.35 + Math.sin(climbPhase) * 0.55;
      return;
    }

    if (armRaise) {
      if (rig.armL) rig.armL.rotation.x = -armRaise;
      if (rig.armR) rig.armR.rotation.x = -armRaise;
    } else {
      if (rig.armL) rig.armL.rotation.x = -armSwing;
      if (rig.armR) rig.armR.rotation.x = armSwing;
    }

    if (rig.legL) rig.legL.rotation.x = legSwing;
    if (rig.legR) rig.legR.rotation.x = -legSwing;
  }

  createPawnMesh(characterId, playerIndex) {
    const root = new THREE.Group();

    // Cincin giliran aktif di bawah kaki karakter
    const activeRing = new THREE.Mesh(
      new THREE.RingGeometry(0.46, 0.62, 24),
      new THREE.MeshBasicMaterial({ color: '#fef08a', side: THREE.DoubleSide, transparent: true, opacity: 0.9 })
    );
    activeRing.rotation.x = -Math.PI / 2;
    activeRing.position.y = 0.04;
    activeRing.visible = false;
    root.add(activeRing);
    root.userData.activeRing = activeRing;

    const visualHolder = new THREE.Group();
    root.add(visualHolder);
    root.userData.visualHolder = visualHolder;
    this.populatePawnVisual(root, characterId);

    // Aura Pelindung Kebal Jatuh
    const shieldAura = new THREE.Mesh(
      new THREE.SphereGeometry(0.76, 16, 12),
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
          this.orientPawnTowardNextTile(p.tile, mesh);
        }
      });
    }
    this.syncFppVisibility();
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

  setActivePlayer(playerId) {
    this.activePlayerId = playerId || null;
    this.activeFollowObj = playerId ? this.pawns.get(playerId) || null : null;
    this.syncFppVisibility();
  }

  setActiveFollow(playerId) {
    this.setActivePlayer(playerId);
  }

  syncFppVisibility() {
    const fppPid = this.cameraMode === 'fpp' ? this.activePlayerId : null;
    const activePawn = fppPid ? this.pawns.get(fppPid) : null;
    const activeMeta = fppPid ? this.pawnMeta.get(fppPid) : null;
    this.pawns.forEach((mesh, pid) => {
      const hideOwn = pid === fppPid;
      const meta = this.pawnMeta.get(pid);
      const tooCloseOther = Boolean(
        fppPid &&
          !hideOwn &&
          activePawn &&
          ((activeMeta && meta && activeMeta.tile === meta.tile) ||
            mesh.position.distanceTo(activePawn.position) < 1.25)
      );
      mesh.visible = !tooCloseOther;
      if (mesh.userData?.visualHolder) {
        mesh.userData.visualHolder.visible = !hideOwn;
      }
      if (mesh.userData?.rig?.head) {
        mesh.userData.rig.head.visible = !hideOwn;
      }
      if (mesh.userData?.shieldAura) {
        mesh.userData.shieldAura.visible = !hideOwn && Boolean(meta?.shield);
      }
      if (mesh.userData?.activeRing) {
        mesh.userData.activeRing.visible = !hideOwn && Boolean(meta?.isActive);
      }
    });
  }

  updateTppTreeOcclusion(camPos, pawnPos) {
    if (!this.mountainTreeMeshes.length) return;
    const isTppMountain = this.cameraMode === 'tpp' && this.boardStyle === 'mountain' && Boolean(camPos && pawnPos);
    if (!isTppMountain) {
      for (const m of this.mountainTreeMeshes) m.visible = true;
      return;
    }
    const vx = pawnPos.x - camPos.x;
    const vz = pawnPos.z - camPos.z;
    const len2 = vx * vx + vz * vz;
    for (const m of this.mountainTreeMeshes) {
      m.getWorldPosition(this._treeWorldPos);
      const wx = this._treeWorldPos.x - camPos.x;
      const wz = this._treeWorldPos.z - camPos.z;
      const distCam = Math.hypot(wx, wz);
      let hide = distCam < 1.45;
      if (!hide && len2 > 0.01) {
        const t = (wx * vx + wz * vz) / len2;
        if (t > -0.15 && t < 0.92) {
          const px = camPos.x + t * vx;
          const pz = camPos.z + t * vz;
          const segDist = Math.hypot(this._treeWorldPos.x - px, this._treeWorldPos.z - pz);
          if (segDist < 1.02) hide = true;
        }
      }
      m.visible = !hide;
    }
  }

  setCameraMode(mode, activePlayerId = null) {
    this.cameraMode = ['overview', 'tpp', 'fpp', 'top'].includes(mode) ? mode : 'overview';
    if (activePlayerId) this.setActivePlayer(activePlayerId);
    else this.syncFppVisibility();
    this.updateTppTreeOcclusion(null, null);

    const isPov = this.cameraMode === 'tpp' || this.cameraMode === 'fpp';
    this.controls.enabled = !isPov;
    this.fppYawOffset = 0;
    this.fppPitchOffset = 0;

    if (!isPov) {
      this.setCameraPreset(this.cameraMode, activePlayerId);
    } else {
      this.desiredCameraPos = null;
    }
  }

  async animateHopPath(playerId, pathTiles, onEachStep) {
    const mesh = this.pawns.get(playerId);
    if (!mesh || !pathTiles.length) return;
    this.setActivePlayer(playerId);
    this.isPawnMoving = true;

    const isMountain = this.boardStyle === 'mountain';
    const meta = this.pawnMeta.get(playerId);
    let prevTile = meta ? meta.tile : 0;

    for (let i = 0; i < pathTiles.length; i++) {
      const nextTile = pathTiles[i];
      const startPos = mesh.position.clone();
      if (meta) meta.tile = nextTile;
      const endPos = this.getPawnWorldPos(nextTile, playerId);

      if (typeof onEachStep === 'function') onEachStep(nextTile, i);

      if (isMountain) {
        // Mode Gunung: Berjalan kaki santai & realistis menyusuri jalan setapak & kelokan U-turn
        const rawWps = BoardConfig.getMountainStepWaypoints(prevTile, nextTile);
        const pts = rawWps.map((p) => new THREE.Vector3(p.x, p.y + 0.02, p.z));
        pts[0] = startPos;
        pts[pts.length - 1] = endPos;
        const pathCurve = pts.length > 2 ? new THREE.CatmullRomCurve3(pts) : null;
        const dur = pts.length > 2 ? 950 : 700;
        const t0 = performance.now();

        await new Promise((resolve) => {
          const frame = (now) => {
            const t = Math.min(1, (now - t0) / dur);
            if (pathCurve) {
              const p = pathCurve.getPointAt(t);
              mesh.position.copy(p);
              const tan = pathCurve.getTangentAt(Math.min(0.99, t));
              if (Math.hypot(tan.x, tan.z) > 0.01) {
                mesh.rotation.y = Math.atan2(tan.x, tan.z);
              }
            } else {
              mesh.position.lerpVectors(startPos, endPos, t);
              const dx = endPos.x - startPos.x;
              const dz = endPos.z - startPos.z;
              if (Math.hypot(dx, dz) > 0.03) {
                mesh.rotation.y = Math.atan2(dx, dz);
              }
            }

            const phase = (i * 2 + t * 2) * Math.PI;
            this.applyPawnRigPose(mesh, {
              legSwing: Math.sin(phase) * 0.68,
              armSwing: Math.sin(phase) * 0.52,
              bobY: Math.abs(Math.sin(phase)) * 0.05,
              torsoLean: 0.08
            });

            if (t < 1) requestAnimationFrame(frame);
            else resolve();
          };
          requestAnimationFrame(frame);
        });
      } else {
        // Mode Papan Catur Klasik: Melompat parabolik antar petak
        const dx = endPos.x - startPos.x;
        const dz = endPos.z - startPos.z;
        if (Math.hypot(dx, dz) > 0.05) {
          mesh.rotation.y = Math.atan2(dx, dz);
        }

        const dur = 420;
        const t0 = performance.now();
        await new Promise((resolve) => {
          const frame = (now) => {
            const t = Math.min(1, (now - t0) / dur);
            const jumpArc = Math.sin(t * Math.PI);
            mesh.position.lerpVectors(startPos, endPos, easeInOutQuad(t));
            mesh.position.y += jumpArc * 0.9;
            this.applyPawnRigPose(mesh, {
              armRaise: jumpArc * 1.15,
              legSwing: jumpArc * 0.35,
              torsoLean: jumpArc * 0.1
            });
            if (t < 1) requestAnimationFrame(frame);
            else resolve();
          };
          requestAnimationFrame(frame);
        });
      }

      prevTile = nextTile;
    }

    this.isPawnMoving = false;
    this.applyPawnRigPose(mesh, {});
    this.repositionAllPawnsSmooth();
  }

  async animateLadderClimb(playerId, fromTile, toTile) {
    const mesh = this.pawns.get(playerId);
    if (!mesh) return;
    this.setActivePlayer(playerId);
    this.isPawnMoving = true;
    this.climbOrSlidePitch = 0.24;

    const isMountain = this.boardStyle === 'mountain';
    const mountainCurve = isMountain ? this.mountainLadderCurves.get(fromTile) : null;
    const mountainYaw = isMountain ? this.mountainLadderYaws.get(fromTile) : null;
    const ladder = !isMountain ? this.ladderPaths.get(fromTile) : null;
    const meta = this.pawnMeta.get(playerId);
    if (meta) meta.tile = toTile;

    const startPos = ladder ? ladder.start.clone() : mesh.position.clone();
    const endPos = this.getPawnWorldPos(toTile, playerId);
    const curveStart = mountainCurve ? mountainCurve.getPointAt(0) : startPos;
    const curveEnd = mountainCurve ? mountainCurve.getPointAt(1) : endPos;
    const startOffset = startPos.clone().sub(curveStart);
    const endOffset = endPos.clone().sub(curveEnd);

    const startYaw = mesh.rotation.y;
    const dx = endPos.x - startPos.x;
    const dz = endPos.z - startPos.z;
    const targetYaw =
      typeof mountainYaw === 'number'
        ? mountainYaw
        : Math.hypot(dx, dz) > 0.05
        ? Math.atan2(dx, dz)
        : startYaw;
    const yawDiff = Math.atan2(Math.sin(targetYaw - startYaw), Math.cos(targetYaw - startYaw));

    const dur = 1800;
    const t0 = performance.now();
    await new Promise((resolve) => {
      const frame = (now) => {
        const t = Math.min(1, (now - t0) / dur);
        const eased = easeInOutQuad(t);
        const stepT = THREE.MathUtils.clamp(eased + Math.sin(t * Math.PI * 14) * 0.006, 0, 1);
        const yawAlpha = Math.min(1, t / 0.12);
        mesh.rotation.y = startYaw + yawDiff * easeInOutQuad(yawAlpha);

        if (mountainCurve) {
          const p = mountainCurve.getPointAt(stepT);
          if (t < 0.12) {
            p.addScaledVector(startOffset, 1 - t / 0.12);
          } else if (t > 0.88) {
            p.addScaledVector(endOffset, (t - 0.88) / 0.12);
          }
          mesh.position.copy(p);

          const tan = mountainCurve.getTangentAt(Math.min(0.98, stepT));
          const tanPitch = Math.atan2(tan.y, Math.max(0.15, Math.hypot(tan.x, tan.z)));
          this.climbOrSlidePitch = THREE.MathUtils.clamp(tanPitch * 0.56, 0.12, 0.34);
        } else {
          mesh.position.lerpVectors(startPos, endPos, eased);
        }
        this.applyPawnRigPose(mesh, {
          climbPhase: t * Math.PI * 14,
          torsoLean: 0.16
        });
        mesh.rotation.z = Math.sin(t * Math.PI * 14) * 0.05;
        if (t < 1) requestAnimationFrame(frame);
        else {
          mesh.rotation.z = 0;
          mesh.position.copy(endPos);
          this.applyPawnRigPose(mesh, {});
          this.orientPawnTowardNextTile(toTile, mesh);
          resolve();
        }
      };
      requestAnimationFrame(frame);
    });
    this.climbOrSlidePitch = 0;
    this.isPawnMoving = false;
    this.repositionAllPawnsSmooth();
  }

  async animateSnakeSlide(playerId, fromTile, toTile) {
    const mesh = this.pawns.get(playerId);
    if (!mesh) return;
    this.setActivePlayer(playerId);
    this.isPawnMoving = true;
    const isMountainStream = this.boardStyle === 'mountain' && Boolean(BoardConfig.STREAMS[fromTile]);
    const isMountainLandslide = this.boardStyle === 'mountain' && Boolean(BoardConfig.LANDSLIDES[fromTile]);
    this.climbOrSlidePitch = isMountainStream ? -0.26 : isMountainLandslide ? -0.32 : -0.45;

    const curve =
      this.boardStyle === 'mountain'
        ? this.mountainHazardCurves.get(fromTile)
        : this.snakeCurves.get(fromTile);
    const meta = this.pawnMeta.get(playerId);
    if (meta) meta.tile = toTile;
    const finalPos = this.getPawnWorldPos(toTile, playerId);

    const dur = 2000;
    const t0 = performance.now();
    await new Promise((resolve) => {
      const frame = (now) => {
        const t = Math.min(1, (now - t0) / dur);
        const eased = easeInOutQuad(t);
        if (curve) {
          const p = curve.getPointAt(eased);
          mesh.position.copy(p);
          const tangent = curve.getTangentAt(Math.min(0.99, eased));
          mesh.rotation.y = Math.atan2(tangent.x, tangent.z);

          if (isMountainStream) {
            mesh.position.y += 0.04 + Math.sin(t * Math.PI * 14) * 0.025;
            mesh.rotation.z = Math.sin(t * Math.PI * 10) * 0.12;
            const tanPitch = Math.atan2(tangent.y, Math.max(0.15, Math.hypot(tangent.x, tangent.z)));
            this.climbOrSlidePitch = THREE.MathUtils.clamp(tanPitch * 0.65, -0.52, -0.18);
          } else if (isMountainLandslide) {
            mesh.position.y += 0.03 + Math.abs(Math.sin(t * Math.PI * 16)) * 0.025;
            mesh.rotation.z = Math.sin(t * Math.PI * 12) * 0.14;
            const tanPitch = Math.atan2(tangent.y, Math.max(0.15, Math.hypot(tangent.x, tangent.z)));
            this.climbOrSlidePitch = THREE.MathUtils.clamp(tanPitch * 0.68, -0.55, -0.20);
          } else {
            mesh.position.y += 0.25;
            mesh.rotation.z = Math.sin(t * Math.PI * 8) * 0.16;
          }
        } else {
          mesh.position.lerp(finalPos, eased);
        }

        if (isMountainStream) {
          this.applyPawnRigPose(mesh, {
            armRaise: 1.15 + Math.sin(t * Math.PI * 10) * 0.35,
            legSwing: Math.sin(t * Math.PI * 10) * 0.28,
            torsoLean: -0.14
          });
        } else if (isMountainLandslide) {
          this.applyPawnRigPose(mesh, {
            armRaise: 1.45 + Math.sin(t * Math.PI * 14) * 0.35,
            legSwing: Math.sin(t * Math.PI * 14) * 0.32,
            torsoLean: -0.20
          });
        } else {
          this.applyPawnRigPose(mesh, {
            armRaise: 2.2 + Math.sin(t * Math.PI * 12) * 0.35,
            legSwing: Math.sin(t * Math.PI * 12) * 0.4,
            torsoLean: -0.22
          });
        }
        if (t < 1) requestAnimationFrame(frame);
        else {
          mesh.rotation.z = 0;
          mesh.position.copy(finalPos);
          this.applyPawnRigPose(mesh, {});
          if (isMountainStream || isMountainLandslide) {
            this.orientPawnTowardNextTile(toTile, mesh);
          }
          resolve();
        }
      };
      requestAnimationFrame(frame);
    });
    this.climbOrSlidePitch = 0;
    this.isPawnMoving = false;
    this.repositionAllPawnsSmooth();
  }

  orientPawnTowardNextTile(tile, mesh) {
    if (!mesh) return;
    let fromP;
    let toP;
    if (tile >= 100) {
      fromP = BoardConfig.tileToWorld(99, this.boardStyle);
      toP = BoardConfig.tileToWorld(100, this.boardStyle);
    } else {
      fromP = BoardConfig.tileToWorld(tile, this.boardStyle);
      toP = BoardConfig.tileToWorld(tile + 1, this.boardStyle);
    }
    const dx = toP.x - fromP.x;
    const dz = toP.z - fromP.z;
    if (Math.hypot(dx, dz) > 0.02) {
      mesh.rotation.y = Math.atan2(dx, dz);
    }
  }

  repositionAllPawnsSmooth() {
    this.pawnMeta.forEach((meta, pid) => {
      const mesh = this.pawns.get(pid);
      if (mesh) {
        mesh.position.copy(this.getPawnWorldPos(meta.tile, pid));
        this.orientPawnTowardNextTile(meta.tile, mesh);
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
    if (this.cameraMode !== 'tpp' && this.cameraMode !== 'fpp') {
      this.setCameraPreset(this.cameraMode);
    }
    this.updateTppTreeOcclusion(null, null);
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

    const fppPid = this.cameraMode === 'fpp' ? this.activePlayerId : null;
    this.pawns.forEach((mesh, pid) => {
      const el = this.overlayEls.get(pid);
      if (!el) return;
      if (pid === fppPid || !mesh.visible) {
        el.style.opacity = '0';
        return;
      }
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

    // Kamera POV (TPP / FPP) atau Orbit / Auto-Follow
    const now = performance.now();
    const povPawn =
      (this.activePlayerId ? this.pawns.get(this.activePlayerId) : null) || this.activeFollowObj;

    if ((this.cameraMode === 'tpp' || this.cameraMode === 'fpp') && povPawn) {
      if (this.isPawnMoving && !this.povDragging) {
        this.fppYawOffset *= 0.94;
        this.fppPitchOffset *= 0.94;
      }

      const yaw = povPawn.rotation.y + this.fppYawOffset;
      const fwd = new THREE.Vector3(Math.sin(yaw), 0, Math.cos(yaw));
      const right = new THREE.Vector3(-Math.cos(yaw), 0, Math.sin(yaw));

      if (this.cameraMode === 'tpp') {
        const shoulderPivot = povPawn.position.clone().add(new THREE.Vector3(0, 1.32, 0));
        const desiredPos = povPawn.position
          .clone()
          .addScaledVector(fwd, -2.75)
          .addScaledVector(right, 0.32);
        desiredPos.y += 1.95 + this.fppPitchOffset * 1.4;

        if (this.boardStyle === 'mountain' && this.tppColliders.length > 0) {
          const camVec = desiredPos.clone().sub(shoulderPivot);
          const camDist = camVec.length();
          if (camDist > 0.1) {
            this.tppRaycaster.set(shoulderPivot, camVec.clone().normalize());
            this.tppRaycaster.far = camDist + 0.3;
            const hits = this.tppRaycaster.intersectObjects(this.tppColliders, false);
            if (hits.length > 0 && hits[0].distance < camDist) {
              const safeDist = Math.max(1.1, hits[0].distance - 0.38);
              desiredPos.copy(shoulderPivot).addScaledVector(camVec.normalize(), safeDist);
              desiredPos.y += 0.28;
            }
          }

          const skyOrigin = new THREE.Vector3(desiredPos.x, desiredPos.y + 10, desiredPos.z);
          this.tppRaycaster.set(skyOrigin, new THREE.Vector3(0, -1, 0));
          this.tppRaycaster.far = 14;
          const floorHits = this.tppRaycaster.intersectObjects(this.tppColliders, false);
          if (floorHits.length > 0) {
            const groundY = floorHits[0].point.y;
            if (desiredPos.y < groundY + 0.55) {
              desiredPos.y = groundY + 0.65;
            }
          }
        }

        const lookTarget = povPawn.position.clone().addScaledVector(fwd, 2.8);
        lookTarget.y += 1.15 - this.fppPitchOffset * 1.2 + this.climbOrSlidePitch * 0.9;

        this.camera.position.lerp(desiredPos, 0.14);
        this.controls.target.lerp(lookTarget, 0.18);
        this.camera.lookAt(this.controls.target);
        this.updateTppTreeOcclusion(this.camera.position, povPawn.position);
      } else {
        this.syncFppVisibility();
        const bob = povPawn.userData?.rig?.bodyGroup?.position?.y || 0;
        const eyePos = povPawn.position.clone().addScaledVector(fwd, 0.2);
        eyePos.y += 1.28 + bob;

        const pitch = THREE.MathUtils.clamp(
          this.climbOrSlidePitch + this.fppPitchOffset - 0.08,
          -0.75,
          0.85
        );
        const lookDir = new THREE.Vector3(
          Math.sin(yaw) * Math.cos(pitch),
          Math.sin(pitch),
          Math.cos(yaw) * Math.cos(pitch)
        );
        const lookTarget = eyePos.clone().addScaledVector(lookDir, 4.0);

        this.camera.position.lerp(eyePos, 0.35);
        this.controls.target.lerp(lookTarget, 0.35);
        this.camera.lookAt(this.controls.target);
      }
    } else {
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
    }

    this.updateWildernessAtmosphere(t);
    this.renderer.render(this.scene, this.camera);
    this.updateOverlays();
  }

  updateWildernessAtmosphere(t) {
    const isMountain = this.boardStyle === 'mountain';
    const isPov = this.cameraMode === 'tpp' || this.cameraMode === 'fpp';
    const activeMeta = this.activePlayerId ? this.pawnMeta.get(this.activePlayerId) : null;
    const zoneIdx =
      isMountain && isPov && activeMeta ? BoardConfig.getWildernessZoneIndex(activeMeta.tile) : -1;
    const inWilderness = zoneIdx !== -1;

    if (this.wildernessGroup) {
      this.wildernessGroup.visible = isMountain && isPov;
    }
    if (this.wildernessTreesGroup) {
      this.wildernessTreesGroup.visible = isMountain && isPov;
    }
    this.wildernessZoneGroups.forEach((zg, idx) => {
      zg.visible = inWilderness && idx === zoneIdx;
    });

    if (!isMountain || !isPov) {
      if (this.wildernessBlend > 0) {
        this.wildernessBlend = 0;
        this.setTheme(this.theme);
      }
      this.wildernessLights.forEach((l) => {
        l.intensity = 0;
      });
      this.wildernessZoneFireflies.forEach(({ mat }) => {
        mat.opacity = 0;
      });
      return;
    }

    const target = inWilderness ? 1 : 0;
    this.wildernessBlend += (target - this.wildernessBlend) * 0.08;
    if (!inWilderness && this.wildernessBlend < 0.003) {
      this.wildernessBlend = 0;
      this.setTheme(this.theme);
      this.wildernessLights.forEach((l) => {
        l.intensity = 0;
      });
      this.wildernessZoneFireflies.forEach(({ mat }) => {
        mat.opacity = 0;
      });
      return;
    }

    const b = this.wildernessBlend;
    const isNight = this.theme === 'night';
    const baseSky = new THREE.Color(isNight ? '#090f24' : '#74ccf4');
    const baseFog = new THREE.Color(isNight ? '#0d1633' : '#8cd9fa');
    const abyss = new THREE.Color('#040d12');
    const baseHemiColor = new THREE.Color(isNight ? '#4c6ef5' : '#ffffff');
    const tealTint = new THREE.Color('#2dd4bf');

    if (b > 0.001) {
      this.scene.background = baseSky.lerp(abyss, b);
      if (this.scene.fog) {
        this.scene.fog.color.copy(baseFog).lerp(abyss, b);
        this.scene.fog.density = THREE.MathUtils.lerp(isNight ? 0.011 : 0.0085, 0.034, b);
      }
      this.dirLight.intensity = THREE.MathUtils.lerp(isNight ? 0.65 : 1.55, 0.20, b);
      this.hemiLight.intensity = THREE.MathUtils.lerp(isNight ? 0.55 : 0.88, 0.30, b);
      this.hemiLight.color.copy(baseHemiColor).lerp(tealTint, b);
      this.fillLight.intensity = THREE.MathUtils.lerp(isNight ? 0.25 : 0.45, 0.14, b);
      if (this.starMat) {
        this.starMat.opacity = Math.max(isNight ? 0.9 : 0, b * 0.85);
      }
    }

    this.wildernessLights.forEach((l, idx) => {
      l.intensity = idx === zoneIdx ? 2.8 * b : 0;
    });

    this.wildernessZoneFireflies.forEach((zoneFly, idx) => {
      const activeZoneFly = inWilderness && idx === zoneIdx;
      zoneFly.mat.opacity = activeZoneFly ? 0.9 * b : 0;
      if (!activeZoneFly) return;
      const posAttr = zoneFly.points.geometry.attributes.position;
      for (let i = 0; i < posAttr.count; i++) {
        posAttr.setY(i, zoneFly.baseY[i] + Math.sin(t * 1.9 + i * 0.65) * 0.25);
      }
      posAttr.needsUpdate = true;
    });
  }
}
