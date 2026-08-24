import * as THREE from 'three';
import { BALL, COLORS, FORMATIONS, HOME_NAMES, AWAY_NAMES, MATCH, PITCH, PLAYER, ROLES } from './constants.js';

const V3 = () => new THREE.Vector3();
const clamp = THREE.MathUtils.clamp;
const lerp = THREE.MathUtils.lerp;
const rand = (a, b) => a + Math.random() * (b - a);

export class FootballGame {
  constructor(container, input) {
    this.container = container;
    this.input = input;
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x87b5d8);
    this.scene.fog = new THREE.Fog(0x87b5d8, 85, 190);

    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.renderer.setSize(innerWidth, innerHeight);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.renderer.domElement.className = 'webgl';
    container.appendChild(this.renderer.domElement);

    this.camera = new THREE.PerspectiveCamera(47, innerWidth / innerHeight, 0.1, 400);
    this.cameraMode = 0;
    this.cameraLook = new THREE.Vector3();
    this.cameraTarget = new THREE.Vector3();

    this.players = [];
    this.teams = { home: [], away: [] };
    this.score = { home: 0, away: 0 };
    this.matchElapsed = 0;
    this.phase = 'kickoff';
    this.phaseTimer = MATCH.kickoffDelay;
    this.restartData = null;
    this.halftimeDone = false;
    this.paused = false;
    this.controlled = null;
    this.shotCharge = 0;
    this.shotCharging = false;
    this.lastGoalTeam = null;
    this.events = [];
    this.statusTimer = 0;
    this.cameraShake = 0;

    this.createLights();
    this.createPitch();
    this.createGoals();
    this.createStadium();
    this.createPlayers();
    this.createBall();
    this.createHUD();
    this.selectPlayer(this.teams.home[9]);
    this.kickoff('home', true);

    this.audio = this.createAudio();
    window.addEventListener('pointerdown', () => this.audio.unlock(), { once: true });
    window.addEventListener('keydown', () => this.audio.unlock(), { once: true });
    window.addEventListener('resize', () => this.resize());
  }

  createLights() {
    const hemi = new THREE.HemisphereLight(0xd7efff, 0x24452a, 2.0);
    this.scene.add(hemi);
    const sun = new THREE.DirectionalLight(0xffffff, 3.2);
    sun.position.set(-25, 62, 34);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.camera.left = -78;
    sun.shadow.camera.right = 78;
    sun.shadow.camera.top = 65;
    sun.shadow.camera.bottom = -65;
    sun.shadow.camera.near = 1;
    sun.shadow.camera.far = 160;
    sun.shadow.bias = -0.0003;
    this.scene.add(sun);
  }

  createPitch() {
    const grass = new THREE.Mesh(
      new THREE.PlaneGeometry(PITCH.length + 8, PITCH.width + 8),
      new THREE.MeshStandardMaterial({ color: COLORS.grassA, roughness: 0.95 })
    );
    grass.rotation.x = -Math.PI / 2;
    grass.receiveShadow = true;
    this.scene.add(grass);

    const stripeW = PITCH.length / 14;
    for (let i = 0; i < 14; i++) {
      if (i % 2 === 0) continue;
      const stripe = new THREE.Mesh(
        new THREE.PlaneGeometry(stripeW, PITCH.width),
        new THREE.MeshBasicMaterial({ color: COLORS.grassB, transparent: true, opacity: 0.55 })
      );
      stripe.rotation.x = -Math.PI / 2;
      stripe.position.set(-PITCH.halfL + stripeW * (i + 0.5), 0.006, 0);
      this.scene.add(stripe);
    }

    const white = new THREE.LineBasicMaterial({ color: COLORS.line });
    const line = (pts) => {
      const geo = new THREE.BufferGeometry().setFromPoints(pts.map(([x, z]) => new THREE.Vector3(x, 0.025, z)));
      const l = new THREE.Line(geo, white);
      this.scene.add(l);
      return l;
    };
    const rect = (x1, z1, x2, z2) => line([[x1,z1],[x2,z1],[x2,z2],[x1,z2],[x1,z1]]);

    rect(-PITCH.halfL, -PITCH.halfW, PITCH.halfL, PITCH.halfW);
    line([[0,-PITCH.halfW],[0,PITCH.halfW]]);
    rect(-PITCH.halfL,-PITCH.boxHalfW,-PITCH.halfL+PITCH.boxDepth,PITCH.boxHalfW);
    rect(PITCH.halfL-PITCH.boxDepth,-PITCH.boxHalfW,PITCH.halfL,PITCH.boxHalfW);
    rect(-PITCH.halfL,-PITCH.sixHalfW,-PITCH.halfL+PITCH.sixDepth,PITCH.sixHalfW);
    rect(PITCH.halfL-PITCH.sixDepth,-PITCH.sixHalfW,PITCH.halfL,PITCH.sixHalfW);

    const circlePts = [];
    for (let i = 0; i <= 64; i++) {
      const a = i / 64 * Math.PI * 2;
      circlePts.push([Math.cos(a) * PITCH.centerCircle, Math.sin(a) * PITCH.centerCircle]);
    }
    line(circlePts);

    const dotGeo = new THREE.CircleGeometry(0.12, 16);
    const dotMat = new THREE.MeshBasicMaterial({ color: COLORS.line });
    for (const x of [0, -41.5, 41.5]) {
      const d = new THREE.Mesh(dotGeo, dotMat);
      d.rotation.x = -Math.PI / 2;
      d.position.set(x, 0.03, 0);
      this.scene.add(d);
    }

    const cornerMat = new THREE.LineBasicMaterial({ color: COLORS.line });
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
      const pts = [];
      const cx = sx * PITCH.halfL, cz = sz * PITCH.halfW;
      for (let i = 0; i <= 12; i++) {
        const a = i / 12 * Math.PI / 2;
        pts.push(new THREE.Vector3(cx - sx * Math.cos(a), .026, cz - sz * Math.sin(a)));
      }
      this.scene.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), cornerMat));
    }
  }

  createGoals() {
    this.goalMeshes = [];
    const postMat = new THREE.MeshStandardMaterial({ color: 0xffffff, metalness: .08, roughness: .4 });
    const netMat = new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: .35 });
    for (const side of [-1, 1]) {
      const x = side * PITCH.halfL;
      const backX = side * (PITCH.halfL + PITCH.goalDepth);
      const group = new THREE.Group();
      const cyl = (radius, length) => new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, length, 10), postMat);
      for (const z of [-PITCH.goalWidth/2, PITCH.goalWidth/2]) {
        const p = cyl(.07, PITCH.goalHeight);
        p.position.set(x, PITCH.goalHeight/2, z);
        p.castShadow = true;
        group.add(p);
      }
      const bar = cyl(.07, PITCH.goalWidth);
      bar.rotation.x = Math.PI / 2;
      bar.position.set(x, PITCH.goalHeight, 0);
      group.add(bar);

      const netPts = [];
      const z0 = -PITCH.goalWidth/2, z1 = PITCH.goalWidth/2;
      for (let i = 0; i <= 8; i++) {
        const z = lerp(z0, z1, i/8);
        netPts.push(new THREE.Vector3(x, 0, z), new THREE.Vector3(backX, 0, z));
        netPts.push(new THREE.Vector3(x, PITCH.goalHeight, z), new THREE.Vector3(backX, PITCH.goalHeight*.86, z));
      }
      for (let i = 0; i <= 5; i++) {
        const y = PITCH.goalHeight * i / 5;
        netPts.push(new THREE.Vector3(backX, y*.86, z0), new THREE.Vector3(backX, y*.86, z1));
        netPts.push(new THREE.Vector3(x, y, z0), new THREE.Vector3(backX, y*.86, z0));
        netPts.push(new THREE.Vector3(x, y, z1), new THREE.Vector3(backX, y*.86, z1));
      }
      const net = new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(netPts), netMat);
      group.add(net);
      this.scene.add(group);
      this.goalMeshes.push(group);
    }
  }

  createStadium() {
    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(210, 150),
      new THREE.MeshStandardMaterial({ color: 0x3f4d43, roughness: 1 })
    );
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -0.05;
    ground.receiveShadow = true;
    this.scene.add(ground);

    const standMat = new THREE.MeshStandardMaterial({ color: 0x343b44, roughness: .9 });
    const seatMats = [0x1e5eac,0xe5e7eb,0xb92835,0x171b22].map(c => new THREE.MeshStandardMaterial({ color:c, roughness:.8 }));
    const stands = [
      [0,-50,120,20,10],[0,50,120,20,10],[-69,0,20,78,9],[69,0,20,78,9]
    ];
    for (const [x,z,w,d,h] of stands) {
      const base = new THREE.Mesh(new THREE.BoxGeometry(w,h,d), standMat);
      base.position.set(x,h/2,z);
      base.castShadow = base.receiveShadow = true;
      this.scene.add(base);
      const rows = Math.max(4, Math.floor((Math.min(w,d))/3));
      for(let r=0;r<rows;r++){
        const isSide = w > d;
        const sw = isSide ? w*.92 : 1.3;
        const sd = isSide ? 1.3 : d*.92;
        const seat = new THREE.Mesh(new THREE.BoxGeometry(sw,.45,sd), seatMats[r%seatMats.length]);
        const inward = z ? -Math.sign(z) : -Math.sign(x);
        if(isSide) seat.position.set(x, h + .3 + r*.33, z + inward*(d*.3-r*.75));
        else seat.position.set(x + inward*(w*.3-r*.75), h + .3 + r*.33, z);
        this.scene.add(seat);
      }
    }

    const mastMat = new THREE.MeshStandardMaterial({ color:0x454d55, metalness:.65, roughness:.35 });
    for (const x of [-67,67]) for(const z of [-44,44]) {
      const mast = new THREE.Mesh(new THREE.CylinderGeometry(.16,.22,28,8), mastMat);
      mast.position.set(x,14,z);
      this.scene.add(mast);
      const lamp = new THREE.Mesh(new THREE.BoxGeometry(5,2.4,.6), new THREE.MeshBasicMaterial({color:0xffffee}));
      lamp.position.set(x,27,z);
      this.scene.add(lamp);
    }
  }

  createPlayers() {
    const build = (team, i) => {
      const keeper = i === 0;
      const jerseyColor = keeper ? (team === 'home' ? COLORS.keeperHome : COLORS.keeperAway) : COLORS[team];
      const shortsColor = team === 'home' ? COLORS.homeShorts : COLORS.awayShorts;
      const root = new THREE.Group();
      const jersey = new THREE.MeshStandardMaterial({ color: jerseyColor, roughness: .7 });
      const shorts = new THREE.MeshStandardMaterial({ color: shortsColor, roughness: .78 });
      const skin = new THREE.MeshStandardMaterial({ color: COLORS.skin, roughness: .82 });
      const sock = new THREE.MeshStandardMaterial({ color: team === 'home' ? 0xe9f2ff : 0xffe8e8, roughness:.8 });
      const boot = new THREE.MeshStandardMaterial({ color:0x101114, roughness:.65 });

      const torso = new THREE.Mesh(new THREE.CapsuleGeometry(.34,.58,4,8), jersey);
      torso.position.y = 1.25; torso.castShadow = true; root.add(torso);
      const hips = new THREE.Mesh(new THREE.BoxGeometry(.63,.32,.42), shorts);
      hips.position.y=.87; hips.castShadow=true; root.add(hips);
      const head = new THREE.Mesh(new THREE.SphereGeometry(.27,14,10),skin);
      head.position.y=2.02; head.castShadow=true; root.add(head);

      const limb = (mat,r=.105,len=.62) => new THREE.Mesh(new THREE.CylinderGeometry(r,r*.9,len,8),mat);
      const leftLeg = limb(sock,.12,.72), rightLeg = limb(sock,.12,.72);
      leftLeg.position.set(-.18,.47,0); rightLeg.position.set(.18,.47,0);
      leftLeg.castShadow=rightLeg.castShadow=true; root.add(leftLeg,rightLeg);
      const leftBoot = new THREE.Mesh(new THREE.BoxGeometry(.22,.15,.38),boot), rightBoot=leftBoot.clone();
      leftBoot.position.set(-.18,.09,.08); rightBoot.position.set(.18,.09,.08); root.add(leftBoot,rightBoot);
      const leftArm=limb(skin,.09,.62), rightArm=limb(skin,.09,.62);
      leftArm.position.set(-.46,1.25,0); rightArm.position.set(.46,1.25,0);
      leftArm.rotation.z=-.15; rightArm.rotation.z=.15; root.add(leftArm,rightArm);

      const marker = new THREE.Mesh(
        new THREE.RingGeometry(.63,.78,24),
        new THREE.MeshBasicMaterial({ color:0xffeb55, side:THREE.DoubleSide, transparent:true, opacity:.95 })
      );
      marker.rotation.x=-Math.PI/2; marker.position.y=.035; marker.visible=false; root.add(marker);

      const [x,z] = FORMATIONS[team][i];
      root.position.set(x,0,z);
      root.rotation.y = team === 'home' ? Math.PI/2 : -Math.PI/2;
      this.scene.add(root);

      const p = {
        team, index:i, role:ROLES[i], name:(team==='home'?HOME_NAMES:AWAY_NAMES)[i], number:i+1,
        mesh:root, marker, velocity:V3(), facing:new THREE.Vector3(team==='home'?1:-1,0,0),
        home:new THREE.Vector3(x,0,z), stamina:100, active:true, keeper, card:0,
        aiTimer:rand(.05,.4), kickCooldown:0, tackleTimer:0, anim:rand(0,Math.PI*2),
        parts:{leftLeg,rightLeg,leftArm,rightArm}, desired:V3(), lastMove:V3(),
      };
      this.players.push(p); this.teams[team].push(p);
      return p;
    };
    for(let i=0;i<11;i++) build('home',i);
    for(let i=0;i<11;i++) build('away',i);
  }

  createBall() {
    const mesh = new THREE.Mesh(
      new THREE.SphereGeometry(BALL.radius, 20, 14),
      new THREE.MeshStandardMaterial({ color:0xf4f4f0, roughness:.48, metalness:.02 })
    );
    mesh.castShadow = true;
    mesh.position.set(0,BALL.radius,0);
    this.scene.add(mesh);
    const seam = new THREE.Mesh(
      new THREE.TorusGeometry(BALL.radius*.78,.012,5,18),
      new THREE.MeshBasicMaterial({color:0x191919})
    );
    seam.rotation.x=Math.PI/2; mesh.add(seam);
    this.ball = { mesh, velocity:V3(), spin:V3(), owner:null, lastTouch:null, lastTeam:null, ageSinceKick:0 };
  }

  createHUD() {
    const hud = document.createElement('div');
    hud.className='hud';
    hud.innerHTML = `
      <div class="event-feed" id="eventFeed"></div>
      <div class="scoreboard"><div class="team-box home"><span>BLUE XI</span><span id="homeScore">0</span></div><div class="score"><span id="scoreMid">0–0</span></div><div class="team-box away"><span id="awayScore">0</span><span>RED XI</span></div></div>
      <div class="clock" id="clock">00:00 · 1ºT</div>
      <div class="status" id="status">KICK-OFF</div>
      <div class="player-panel"><div class="player-name"><span id="playerName">—</span><span class="player-role" id="playerRole">—</span></div><div class="stamina-label">STAMINA</div><div class="stamina-track"><div class="stamina-fill" id="staminaFill"></div></div></div>
      <div class="mini"><canvas id="radar" width="428" height="280"></canvas></div>
      <div class="power-wrap" id="powerWrap"><div class="power-bar" id="powerBar"></div></div>
      <div class="controls"><b>WASD</b> mover · <b>Shift</b> sprint<br><b>Q</b> passe · <b>E</b> enfiada · <b>C</b> cavadinha<br><b>Espaço</b> segurar/chutar · <b>F</b> carrinho/desarme<br><b>Tab</b> trocar jogador · <b>R</b> câmera · <b>Esc</b> pausa</div>
      <div class="pause" id="pause"><div class="pause-card"><div class="pause-title">PAUSADO</div><div class="pause-sub">Esc para continuar</div></div></div>
      <div class="hint" id="hint"></div>`;
    this.container.appendChild(hud);
    this.ui = {
      hud, home:document.querySelector('#homeScore'), away:document.querySelector('#awayScore'), mid:document.querySelector('#scoreMid'),
      clock:document.querySelector('#clock'), status:document.querySelector('#status'), playerName:document.querySelector('#playerName'),
      playerRole:document.querySelector('#playerRole'), stamina:document.querySelector('#staminaFill'), powerWrap:document.querySelector('#powerWrap'),
      powerBar:document.querySelector('#powerBar'), pause:document.querySelector('#pause'), feed:document.querySelector('#eventFeed'), hint:document.querySelector('#hint'),
      radar:document.querySelector('#radar'), radarCtx:document.querySelector('#radar').getContext('2d')
    };
  }

  createAudio() {
    let ctx = null, master = null, crowd = null;
    const unlock = () => {
      if (!ctx) {
        ctx = new (window.AudioContext || window.webkitAudioContext)();
        master = ctx.createGain(); master.gain.value=.18; master.connect(ctx.destination);
        const len = ctx.sampleRate * 2;
        const buffer = ctx.createBuffer(1,len,ctx.sampleRate);
        const data = buffer.getChannelData(0);
        let v=0;
        for(let i=0;i<len;i++){v=v*.97+(Math.random()*2-1)*.03;data[i]=v*.5;}
        crowd=ctx.createBufferSource(); crowd.buffer=buffer; crowd.loop=true;
        const filter=ctx.createBiquadFilter(); filter.type='bandpass'; filter.frequency.value=600; filter.Q.value=.45;
        const gain=ctx.createGain(); gain.gain.value=.07; crowd.connect(filter).connect(gain).connect(master); crowd.start();
      }
      if(ctx.state==='suspended') ctx.resume();
    };
    const tone=(freq=440,dur=.08,type='sine',gain=.12)=>{ if(!ctx)return; const o=ctx.createOscillator(),g=ctx.createGain(); o.type=type;o.frequency.value=freq;g.gain.setValueAtTime(gain,ctx.currentTime);g.gain.exponentialRampToValueAtTime(.001,ctx.currentTime+dur);o.connect(g).connect(master);o.start();o.stop(ctx.currentTime+dur); };
    return { unlock, kick:()=>tone(105,.055,'triangle',.13), whistle:()=>{tone(1600,.16,'square',.07);setTimeout(()=>tone(1900,.12,'square',.05),95)}, goal:()=>{tone(392,.2,'sawtooth',.12);setTimeout(()=>tone(523,.3,'sawtooth',.13),120)}, tackle:()=>tone(75,.06,'square',.08) };
  }

  kickoff(team='home', initial=false) {
    this.phase='kickoff'; this.phaseTimer=MATCH.kickoffDelay; this.restartData={team,type:'kickoff'};
    this.ball.owner=null; this.ball.velocity.set(0,0,0); this.ball.spin.set(0,0,0); this.ball.mesh.position.set(0,BALL.radius,0);
    for(const p of this.players){
      if(!p.active) continue;
      p.mesh.position.copy(p.home); p.velocity.set(0,0,0); p.facing.set(p.team==='home'?1:-1,0,0);
      p.mesh.rotation.y=p.team==='home'?Math.PI/2:-Math.PI/2;
    }
    const striker=this.teams[team][9]; striker.mesh.position.x = team==='home' ? -1.1 : 1.1;
    const support=this.teams[team][8]; support.mesh.position.set(team==='home'?-2.4:2.4,0,1.8);
    if(team==='home') this.selectPlayer(striker);
    this.showStatus(initial?'COMEÇA O JOGO':'KICK-OFF',1.2);
  }

  startRestart(data) {
    this.phase='restart'; this.phaseTimer=MATCH.restartDelay; this.restartData=data;
    this.ball.owner=null; this.ball.velocity.set(0,0,0); this.ball.spin.set(0,0,0);
    this.ball.mesh.position.set(data.x,BALL.radius,data.z);
    this.showStatus(data.label || data.type.toUpperCase(),1.4);
    if(data.label) this.addEvent(data.label, data.team==='home'?'BLUE XI':'RED XI');
  }

  executeRestart() {
    const d=this.restartData;
    if(!d){this.phase='play';return;}
    if(d.type==='kickoff'){
      const p=this.teams[d.team][9];
      this.givePossession(p); this.phase='play';
      if(d.team==='home') this.selectPlayer(p);
      return;
    }
    const candidates=this.teams[d.team].filter(p=>p.active && !p.keeper);
    let taker=candidates[0], best=Infinity;
    for(const p of candidates){const dist=p.mesh.position.distanceTo(this.ball.mesh.position);if(dist<best){best=dist;taker=p;}}
    taker.mesh.position.set(d.x + (d.team==='home'?-1.0:1.0),0,clamp(d.z,-PITCH.halfW+.6,PITCH.halfW-.6));
    taker.facing.set(d.team==='home'?1:-1,0,0);
    this.givePossession(taker);
    if(d.team==='home') this.selectPlayer(taker);
    this.phase='play';
    if(d.type==='throw') {
      const target=this.findPassTarget(taker,true);
      if(target) this.kickTo(taker,target.mesh.position,11,2.8,false);
    }
  }

  givePossession(player) {
    if(!player || !player.active) return;
    this.ball.owner=player; this.ball.lastTouch=player; this.ball.lastTeam=player.team; this.ball.velocity.set(0,0,0); this.ball.ageSinceKick=0;
    if(player.team==='home') this.selectPlayer(player);
  }

  releaseBall(player) {
    if(this.ball.owner===player) this.ball.owner=null;
    this.ball.lastTouch=player; this.ball.lastTeam=player.team; this.ball.ageSinceKick=0;
  }

  selectPlayer(player) {
    if(!player || !player.active || player.team!=='home') return;
    if(this.controlled) this.controlled.marker.visible=false;
    this.controlled=player; player.marker.visible=true;
    if(this.ui){this.ui.playerName.textContent=`${player.number}. ${player.name}`;this.ui.playerRole.textContent=player.role;}
  }

  update(dt) {
    if(this.input.tap('Escape')) { this.paused=!this.paused; this.ui.pause.classList.toggle('visible',this.paused); }
    if(this.paused) { this.updateCamera(dt); this.render(); return; }

    if(this.input.tap('KeyR')) { this.cameraMode=(this.cameraMode+1)%3; this.flashHint(['CÂMERA TV','CÂMERA JOGADOR','CÂMERA TÁTICA'][this.cameraMode]); }
    if(this.input.tap('Tab')) this.manualSwitch();

    if(this.phase==='play') {
      this.matchElapsed += dt;
      if(!this.halftimeDone && this.matchElapsed>=MATCH.halftimeAt){
        this.halftimeDone=true; this.phase='halftime'; this.phaseTimer=3; this.ball.owner=null; this.showStatus('INTERVALO',3); this.audio.whistle(); this.addEvent('Intervalo',`${this.score.home}–${this.score.away}`);
      } else if(this.matchElapsed>=MATCH.durationSeconds){
        this.phase='finished'; this.ball.owner=null; this.showStatus('FIM DE JOGO',99); this.audio.whistle(); this.addEvent('Fim de jogo',`${this.score.home}–${this.score.away}`);
      }
    } else if(this.phase==='kickoff' || this.phase==='restart') {
      this.phaseTimer-=dt; if(this.phaseTimer<=0) this.executeRestart();
    } else if(this.phase==='goal') {
      this.phaseTimer-=dt; if(this.phaseTimer<=0) this.kickoff(this.lastGoalTeam==='home'?'away':'home');
    } else if(this.phase==='halftime') {
      this.phaseTimer-=dt; if(this.phaseTimer<=0) this.kickoff('away');
    }

    for(const p of this.players){ p.kickCooldown=Math.max(0,p.kickCooldown-dt); p.tackleTimer=Math.max(0,p.tackleTimer-dt); }
    if(this.phase==='play') {
      this.updateControlled(dt);
      this.updateAI(dt);
      this.resolvePlayerCollisions();
      this.updateBall(dt);
      this.checkBallCapture();
    } else {
      this.animatePlayers(dt);
      this.updateOwnedBall(dt);
    }

    this.updateHUD(dt);
    this.updateCamera(dt);
    this.render();
  }

  updateControlled(dt) {
    const p=this.controlled;
    if(!p || !p.active) return;
    const fwd=new THREE.Vector3(); this.camera.getWorldDirection(fwd); fwd.y=0; fwd.normalize();
    const right=new THREE.Vector3().crossVectors(fwd,new THREE.Vector3(0,1,0)).negate().normalize();
    const move=V3();
    if(this.input.held('KeyW')) move.add(fwd);
    if(this.input.held('KeyS')) move.sub(fwd);
    if(this.input.held('KeyD')) move.add(right);
    if(this.input.held('KeyA')) move.sub(right);
    move.y=0;
    if(move.lengthSq()>0.001) move.normalize();
    const sprint=this.input.held('ShiftLeft')||this.input.held('ShiftRight');
    const maxSpeed=sprint&&p.stamina>2?PLAYER.sprintSpeed:PLAYER.walkSpeed;
    if(sprint&&move.lengthSq()>.1) p.stamina=Math.max(0,p.stamina-PLAYER.staminaDrain*dt); else p.stamina=Math.min(100,p.stamina+PLAYER.staminaRegen*dt);
    this.movePlayer(p,move,maxSpeed,dt,true);

    if(this.ball.owner===p) {
      if(this.input.tap('KeyQ')) this.userPass(p,false,false);
      if(this.input.tap('KeyE')) this.userPass(p,true,false);
      if(this.input.tap('KeyC')) this.userPass(p,false,true);
      if(this.input.tap('Space')) { this.shotCharging=true; this.shotCharge=0; }
      if(this.shotCharging && this.input.held('Space')) this.shotCharge=Math.min(1.4,this.shotCharge+dt);
      if(this.shotCharging && this.input.up('Space')) { this.userShot(p); this.shotCharging=false; this.shotCharge=0; }
    } else {
      this.shotCharging=false; this.shotCharge=0;
      if(this.input.tap('KeyF')) this.tryTackle(p);
    }
  }

  movePlayer(p, dir, maxSpeed, dt, manual=false) {
    if(!p.active) return;
    const target=dir.clone().multiplyScalar(maxSpeed);
    const accel=dir.lengthSq()>.01?PLAYER.accel:PLAYER.decel;
    p.velocity.x=THREE.MathUtils.damp(p.velocity.x,target.x,accel,dt);
    p.velocity.z=THREE.MathUtils.damp(p.velocity.z,target.z,accel,dt);
    p.mesh.position.x+=p.velocity.x*dt; p.mesh.position.z+=p.velocity.z*dt;
    p.mesh.position.x=clamp(p.mesh.position.x,-PITCH.halfL-1.2,PITCH.halfL+1.2);
    p.mesh.position.z=clamp(p.mesh.position.z,-PITCH.halfW-1.2,PITCH.halfW+1.2);
    const sp=Math.hypot(p.velocity.x,p.velocity.z);
    if(sp>.3){ p.facing.set(p.velocity.x,0,p.velocity.z).normalize(); p.mesh.rotation.y=Math.atan2(p.facing.x,p.facing.z); }
    p.lastMove.copy(dir);
    p.anim+=dt*(2.2+sp*1.45);
    const swing=Math.sin(p.anim)*Math.min(.75,sp/8*.75);
    p.parts.leftLeg.rotation.x=swing; p.parts.rightLeg.rotation.x=-swing;
    p.parts.leftArm.rotation.x=-swing*.65; p.parts.rightArm.rotation.x=swing*.65;
  }

  animatePlayers(dt) {
    for(const p of this.players) if(p.active) this.movePlayer(p,V3(),0,dt);
  }

  updateAI(dt) {
    const owner=this.ball.owner;
    const ballPos=this.ball.mesh.position;
    const possTeam=owner?.team || null;
    for(const team of ['home','away']) {
      const squad=this.teams[team].filter(p=>p.active);
      const chaser=this.closestPlayer(team,ballPos,true);
      for(const p of squad) {
        if(p===this.controlled) continue;
        if(p.keeper){ this.updateKeeper(p,dt); continue; }
        if(owner===p){ this.updateBallCarrierAI(p,dt); continue; }
        const dir=V3();
        let target=p.home.clone();
        const attack=team==='home'?1:-1;
        const teamHas=possTeam===team;
        const ballX=ballPos.x;
        target.x += clamp(ballX*.22,-9,9) + (teamHas?attack*4:-attack*1.5);
        target.z += clamp(ballPos.z*.12,-4,4);
        if(teamHas && p.index>=8){ target.x += attack*(4 + p.index%2*2); target.z += Math.sin(this.matchElapsed*.7+p.index)*2.5; }
        if(!teamHas && p===chaser) target.copy(ballPos);
        else if(!teamHas && owner && owner.team!==team && p.index>=5) {
          const d=p.mesh.position.distanceTo(owner.mesh.position);
          if(d<9) target.lerp(owner.mesh.position,.35);
        }
        dir.subVectors(target,p.mesh.position); dir.y=0;
        const dist=dir.length(); if(dist>.25) dir.normalize(); else dir.set(0,0,0);
        this.movePlayer(p,dir,PLAYER.aiSpeed*(dist<1.5?.55:1),dt);
        if(!teamHas && p===chaser && owner && owner.team!==team && p.mesh.position.distanceTo(owner.mesh.position)<PLAYER.tackleRange && p.tackleTimer<=0) {
          if(Math.random()<dt*.8) this.tryTackle(p);
        }
      }
    }
  }

  updateBallCarrierAI(p,dt) {
    const attack=p.team==='home'?1:-1;
    p.aiTimer-=dt;
    const goal=new THREE.Vector3(attack*PITCH.halfL,0,0);
    const distGoal=p.mesh.position.distanceTo(goal);
    const pressure=this.nearestOpponentDistance(p);
    if(p.keeper) { this.updateKeeper(p,dt); return; }
    if(p.aiTimer<=0){
      p.aiTimer=rand(.18,.42);
      if(distGoal<24 && Math.abs(p.mesh.position.z)<18 && Math.random()<.58){ this.aiShot(p); return; }
      if(pressure<2.2 || (distGoal>30 && Math.random()<.15)){
        const target=this.findPassTarget(p,Math.random()<.45);
        if(target && !this.isOffside(target,p.team)) { this.kickTo(p,target.mesh.position,PLAYER.passSpeed+rand(-1.5,2),rand(.15,.65),false); return; }
      }
    }
    const target=goal.clone(); target.z=clamp(p.mesh.position.z*.55,-12,12);
    const dir=target.sub(p.mesh.position).setY(0).normalize();
    if(pressure<3 && Math.random()<dt*.9) dir.z+=rand(-.18,.18);
    dir.normalize();
    this.movePlayer(p,dir,PLAYER.aiSpeed+(distGoal<30?1.0:0),dt);
  }

  updateKeeper(p,dt) {
    const ownX=p.team==='home'?-PITCH.halfL:PITCH.halfL;
    const attack=p.team==='home'?1:-1;
    const ball=this.ball.mesh.position;
    const inOwnBox = p.team==='home' ? ball.x < -PITCH.halfL+PITCH.boxDepth+2 : ball.x > PITCH.halfL-PITCH.boxDepth-2;
    if(this.ball.owner===p){
      p.aiTimer-=dt;
      const dir=new THREE.Vector3(attack,0,clamp(-p.mesh.position.z*.1,-.2,.2)).normalize();
      this.movePlayer(p,dir,3.2,dt);
      if(p.aiTimer<=0){
        p.aiTimer=rand(.8,1.3);
        const target=this.findPassTarget(p,true) || this.teams[p.team][5];
        this.kickTo(p,target.mesh.position,20,4.5,false);
      }
      return;
    }
    let target=new THREE.Vector3(ownX + attack*2.3,0,clamp(ball.z*.28,-4.2,4.2));
    if(inOwnBox && !this.ball.owner) target.copy(ball);
    if(this.ball.owner && this.ball.owner.team!==p.team && inOwnBox) target.x += attack*1.4;
    const dir=target.sub(p.mesh.position).setY(0); if(dir.length()>.2)dir.normalize();else dir.set(0,0,0);
    this.movePlayer(p,dir,PLAYER.keeperSpeed,dt);
  }

  updateOwnedBall(dt) {
    const p=this.ball.owner;
    if(!p) return;
    const lead=.62 + Math.min(.36,Math.hypot(p.velocity.x,p.velocity.z)*.035);
    const target=p.mesh.position.clone().addScaledVector(p.facing,lead);
    target.y=BALL.radius;
    this.ball.mesh.position.lerp(target,1-Math.exp(-18*dt));
    const speed=Math.hypot(p.velocity.x,p.velocity.z);
    this.ball.mesh.rotation.z-=speed*dt*1.7;
    this.ball.lastTouch=p; this.ball.lastTeam=p.team;
  }

  updateBall(dt) {
    if(this.ball.owner){this.updateOwnedBall(dt);return;}
    const b=this.ball;
    b.ageSinceKick+=dt;
    b.velocity.y-=BALL.gravity*dt;
    b.velocity.multiplyScalar(Math.pow(BALL.airDrag,dt*60));
    if(b.spin.lengthSq()>.001){
      const magnus=new THREE.Vector3().crossVectors(b.spin,b.velocity).multiplyScalar(.00055);
      b.velocity.addScaledVector(magnus,dt*60);
      b.spin.multiplyScalar(Math.pow(BALL.spinDrag,dt*60));
    }
    if(b.velocity.length()>BALL.maxSpeed) b.velocity.setLength(BALL.maxSpeed);
    b.mesh.position.addScaledVector(b.velocity,dt);
    b.mesh.rotation.x+=b.velocity.z*dt*1.7; b.mesh.rotation.z-=b.velocity.x*dt*1.7;
    if(b.mesh.position.y<BALL.radius){
      b.mesh.position.y=BALL.radius;
      if(Math.abs(b.velocity.y)>.8)b.velocity.y=-b.velocity.y*BALL.bounce;else b.velocity.y=0;
      const drag=Math.pow(BALL.groundDrag,dt); b.velocity.x*=drag;b.velocity.z*=drag;
      if(Math.hypot(b.velocity.x,b.velocity.z)<.08){b.velocity.x=0;b.velocity.z=0;}
    }
    this.checkGoalAndOut();
  }

  checkGoalAndOut() {
    if(this.phase!=='play' || this.ball.owner) return;
    const p=this.ball.mesh.position;
    if(Math.abs(p.x)>PITCH.halfL && Math.abs(p.z)<PITCH.goalWidth/2 && p.y<PITCH.goalHeight){
      const scoring=p.x>0?'home':'away'; this.goal(scoring); return;
    }
    if(Math.abs(p.z)>PITCH.halfW+.15){
      const team=this.ball.lastTeam==='home'?'away':'home';
      this.startRestart({type:'throw',team,x:clamp(p.x,-PITCH.halfL+1,PITCH.halfL-1),z:Math.sign(p.z)*PITCH.halfW,label:'LATERAL'}); return;
    }
    if(Math.abs(p.x)>PITCH.halfL+.35){
      const end=p.x>0?'right':'left';
      const defending=end==='right'?'away':'home';
      const attacking=defending==='home'?'away':'home';
      if(this.ball.lastTeam===attacking){
        const x=end==='right'?PITCH.halfL-5.5:-PITCH.halfL+5.5;
        this.startRestart({type:'goalKick',team:defending,x,z:0,label:'TIRO DE META'});
      }else{
        const x=end==='right'?PITCH.halfL:-PITCH.halfL; const z=Math.sign(p.z||1)*PITCH.halfW;
        this.startRestart({type:'corner',team:attacking,x,z,label:'ESCANTEIO'});
      }
    }
  }

  checkBallCapture() {
    if(this.ball.owner || this.phase!=='play' || this.ball.ageSinceKick<.09) return;
    const pos=this.ball.mesh.position;
    if(pos.y>1.65) return;
    let candidate=null,best=Infinity;
    for(const p of this.players){
      if(!p.active)continue;
      const d=Math.hypot(p.mesh.position.x-pos.x,p.mesh.position.z-pos.z);
      const range=p.keeper?1.45:PLAYER.controlRange;
      if(d<range && d<best){best=d;candidate=p;}
    }
    if(!candidate)return;
    const speed=Math.hypot(this.ball.velocity.x,this.ball.velocity.z);
    const catchable=candidate.keeper && this.inPenaltyArea(candidate.team,pos);
    if(speed<18 || catchable){
      this.givePossession(candidate);
      if(candidate.team==='home') this.selectPlayer(candidate);
    }
  }

  userPass(p,through,lob) {
    const target=this.findPassTarget(p,through);
    if(!target){this.flashHint('SEM LINHA DE PASSE');return;}
    if(this.isOffside(target,p.team)){this.callOffside(target,p.team);return;}
    const speed=lob?PLAYER.lobSpeed:(through?PLAYER.throughSpeed:PLAYER.passSpeed);
    const point=target.mesh.position.clone();
    if(through) point.addScaledVector(target.facing,4.2);
    this.kickTo(p,point,speed,lob?5.4:.35,through);
  }

  userShot(p) {
    const charge=clamp(this.shotCharge/1.25,0,1);
    const attack=p.team==='home'?1:-1;
    const goal=new THREE.Vector3(attack*(PITCH.halfL+.6), .55+charge*.75, clamp(p.mesh.position.z*.1,-2.6,2.6));
    const facingGoal=new THREE.Vector3(attack,0,0);
    const aim=p.facing.clone().lerp(facingGoal,.42+charge*.22).normalize();
    goal.z += aim.z*9;
    const speed=lerp(17,PLAYER.maxShotSpeed,charge);
    this.kickTo(p,goal,speed,1.0+charge*1.7,false,true);
    this.cameraShake=.2+.25*charge;
  }

  aiShot(p) {
    const attack=p.team==='home'?1:-1;
    const keeper=this.teams[p.team==='home'?'away':'home'][0];
    const target=new THREE.Vector3(attack*(PITCH.halfL+.8),rand(.35,1.65),clamp(-keeper.mesh.position.z*.55+rand(-1.6,1.6),-3.2,3.2));
    this.kickTo(p,target,rand(23,29),rand(.8,2.2),false,true);
  }

  kickTo(p,target,speed,lift=0,through=false,shot=false) {
    if(this.ball.owner!==p || p.kickCooldown>0)return;
    const start=p.mesh.position.clone().addScaledVector(p.facing,.72); start.y=BALL.radius+.03;
    this.ball.mesh.position.copy(start); this.releaseBall(p);
    const dir=target.clone().sub(start); dir.normalize();
    this.ball.velocity.copy(dir.multiplyScalar(speed)); this.ball.velocity.y+=lift;
    const lateral=p.velocity.z*p.facing.x-p.velocity.x*p.facing.z;
    this.ball.spin.set(0,clamp(lateral*.22,-3.5,3.5),0);
    p.kickCooldown=.22; this.audio.kick();
    if(shot) this.addEvent('Finalização',`${p.name} · ${Math.round(speed*3.6)} km/h`);
  }

  findPassTarget(p,through=false) {
    let best=null,bestScore=-Infinity;
    const attack=p.team==='home'?1:-1;
    for(const mate of this.teams[p.team]){
      if(mate===p||!mate.active)continue;
      const to=mate.mesh.position.clone().sub(p.mesh.position); const d=to.length(); if(d<2||d>38)continue;
      const nd=to.normalize();
      const facingScore=nd.dot(p.facing);
      const progress=(mate.mesh.position.x-p.mesh.position.x)*attack;
      const space=this.nearestOpponentDistance(mate);
      let score=facingScore*4 + progress*.16 + Math.min(space,8)*.13 - Math.abs(d-(through?20:13))*.08;
      if(mate.keeper)score-=4;
      if(through && progress>0)score+=2.3;
      if(score>bestScore){bestScore=score;best=mate;}
    }
    return bestScore>-1.2?best:null;
  }

  tryTackle(p) {
    if(p.tackleTimer>0 || !p.active)return;
    p.tackleTimer=.8; this.audio.tackle();
    const opponent=this.ball.owner;
    if(!opponent || opponent.team===p.team)return;
    const dist=p.mesh.position.distanceTo(opponent.mesh.position);
    if(dist>PLAYER.tackleRange)return;
    const toTackler=p.mesh.position.clone().sub(opponent.mesh.position).normalize();
    const fromBehind=opponent.facing.dot(toTackler)<-.25;
    const speed=Math.hypot(p.velocity.x,p.velocity.z);
    const foulChance=.1+(fromBehind?.32:0)+(speed>7?.14:0);
    if(Math.random()<foulChance){ this.callFoul(p,opponent,fromBehind&&speed>6.5); return; }
    const success=.58+(fromBehind?-.14:.12);
    if(Math.random()<success){
      this.releaseBall(opponent);
      this.ball.velocity.copy(p.facing).multiplyScalar(4.5); this.ball.velocity.y=.7; this.ball.ageSinceKick=0;
      if(p.team==='home')this.selectPlayer(p);
      this.addEvent('Desarme',p.name);
    }
  }

  callFoul(offender,victim,serious=false) {
    const spot=victim.mesh.position.clone();
    const team=victim.team;
    let card='';
    if(serious || Math.random()<.3){
      offender.card++;
      if(offender.card>=2 || (serious&&Math.random()<.18)){
        offender.active=false; offender.mesh.visible=false; if(this.controlled===offender)this.manualSwitch(); card=' · VERMELHO';
      }else card=' · AMARELO';
    }
    this.audio.whistle();
    this.startRestart({type:'freeKick',team,x:clamp(spot.x,-49,49),z:clamp(spot.z,-31,31),label:`FALTA${card}`});
    this.addEvent(`Falta${card}`,`${offender.name} em ${victim.name}`);
  }

  callOffside(player,attackingTeam) {
    const defending=attackingTeam==='home'?'away':'home';
    this.audio.whistle();
    this.startRestart({type:'freeKick',team:defending,x:player.mesh.position.x,z:player.mesh.position.z,label:'IMPEDIMENTO'});
    this.addEvent('Impedimento',player.name);
  }

  isOffside(player,team) {
    if(player.keeper)return false;
    const attack=team==='home'?1:-1;
    const x=player.mesh.position.x;
    if(x*attack<=0)return false;
    const defenders=this.teams[team==='home'?'away':'home'].filter(p=>p.active).map(p=>p.mesh.position.x).sort((a,b)=>a-b);
    if(defenders.length<2)return false;
    const line=team==='home'?defenders[defenders.length-2]:defenders[1];
    const ballX=this.ball.mesh.position.x;
    return team==='home' ? x>line+.15 && x>ballX+.15 : x<line-.15 && x<ballX-.15;
  }

  inPenaltyArea(team,pos) {
    return team==='home' ? pos.x<-PITCH.halfL+PITCH.boxDepth && Math.abs(pos.z)<PITCH.boxHalfW : pos.x>PITCH.halfL-PITCH.boxDepth && Math.abs(pos.z)<PITCH.boxHalfW;
  }

  goal(team) {
    if(this.phase!=='play')return;
    this.score[team]++; this.lastGoalTeam=team; this.phase='goal'; this.phaseTimer=3.7; this.ball.owner=null; this.ball.velocity.multiplyScalar(.25);
    const scorer=this.ball.lastTouch;
    this.showStatus('GOOOOOOL!',2.3); this.audio.goal(); this.cameraShake=.55;
    this.addEvent('GOOOL!',scorer?`${scorer.name} · ${team==='home'?'BLUE XI':'RED XI'}`:(team==='home'?'BLUE XI':'RED XI'));
  }

  closestPlayer(team,pos,excludeKeeper=false) {
    let best=null,d=Infinity;
    for(const p of this.teams[team]){if(!p.active||(excludeKeeper&&p.keeper))continue;const dd=p.mesh.position.distanceTo(pos);if(dd<d){d=dd;best=p;}}
    return best;
  }

  nearestOpponentDistance(p) {
    let best=999; const opp=p.team==='home'?'away':'home';
    for(const q of this.teams[opp])if(q.active)best=Math.min(best,p.mesh.position.distanceTo(q.mesh.position));
    return best;
  }

  manualSwitch() {
    if(this.ball.owner?.team==='home'){this.selectPlayer(this.ball.owner);return;}
    const pos=this.ball.owner?.mesh.position||this.ball.mesh.position;
    let best=null,score=Infinity;
    for(const p of this.teams.home){if(!p.active||p.keeper)continue;const d=p.mesh.position.distanceTo(pos)+(p===this.controlled?3:0);if(d<score){score=d;best=p;}}
    if(best)this.selectPlayer(best);
  }

  resolvePlayerCollisions() {
    for(let i=0;i<this.players.length;i++){
      const a=this.players[i]; if(!a.active)continue;
      for(let j=i+1;j<this.players.length;j++){
        const b=this.players[j]; if(!b.active)continue;
        const dx=b.mesh.position.x-a.mesh.position.x,dz=b.mesh.position.z-a.mesh.position.z;
        const ds=dx*dx+dz*dz,min=PLAYER.radius*2;
        if(ds>0.0001&&ds<min*min){const d=Math.sqrt(ds),push=(min-d)*.5,nx=dx/d,nz=dz/d;a.mesh.position.x-=nx*push;a.mesh.position.z-=nz*push;b.mesh.position.x+=nx*push;b.mesh.position.z+=nz*push;}
      }
    }
  }

  updateCamera(dt) {
    const ball=this.ball.mesh.position;
    const player=this.controlled?.mesh.position||ball;
    let desired=V3(),look=V3();
    if(this.cameraMode===0){
      const focus=ball.clone().lerp(player,.18); desired.set(clamp(focus.x*.72,-37,37),30,44+Math.min(5,Math.abs(focus.z)*.1)); look.copy(focus); look.y=1.2;
    }else if(this.cameraMode===1){
      const f=this.controlled?.facing||new THREE.Vector3(1,0,0); desired.copy(player).addScaledVector(f,-8).add(new THREE.Vector3(0,5.2,0)); look.copy(player).addScaledVector(f,5);look.y=1.2;
    }else{
      desired.set(ball.x*.35,54,15); look.set(ball.x*.2,0,ball.z*.15);
    }
    const damp=1-Math.exp(-4.5*dt); this.camera.position.lerp(desired,damp); this.cameraLook.lerp(look,1-Math.exp(-6*dt));
    if(this.cameraShake>0){this.camera.position.x+=rand(-1,1)*this.cameraShake;this.camera.position.y+=rand(-.5,.5)*this.cameraShake;this.cameraShake=Math.max(0,this.cameraShake-dt*1.7);}
    this.camera.lookAt(this.cameraLook);
  }

  updateHUD(dt) {
    this.ui.home.textContent=this.score.home; this.ui.away.textContent=this.score.away; this.ui.mid.textContent=`${this.score.home}–${this.score.away}`;
    const gameMin=Math.min(MATCH.gameMinutes,Math.floor(this.matchElapsed/MATCH.durationSeconds*MATCH.gameMinutes));
    const gameSec=Math.floor((this.matchElapsed/MATCH.durationSeconds*MATCH.gameMinutes*60)%60);
    const half=this.halftimeDone?'2ºT':'1ºT'; this.ui.clock.textContent=`${String(gameMin).padStart(2,'0')}:${String(gameSec).padStart(2,'0')} · ${half}`;
    if(this.controlled){this.ui.stamina.style.width=`${this.controlled.stamina}%`;this.ui.playerName.textContent=`${this.controlled.number}. ${this.controlled.name}`;this.ui.playerRole.textContent=this.controlled.role;}
    this.ui.powerWrap.classList.toggle('visible',this.shotCharging); this.ui.powerBar.style.width=`${clamp(this.shotCharge/1.25,0,1)*100}%`;
    if(this.statusTimer>0){this.statusTimer-=dt;if(this.statusTimer<=0)this.ui.status.classList.remove('visible');}
    this.drawRadar();
  }

  drawRadar() {
    const c=this.ui.radar,ctx=this.ui.radarCtx,w=c.width,h=c.height; ctx.clearRect(0,0,w,h);
    ctx.fillStyle='#0c4424';ctx.fillRect(0,0,w,h);ctx.strokeStyle='#dcebdcaa';ctx.lineWidth=2;ctx.strokeRect(12,12,w-24,h-24);
    ctx.beginPath();ctx.moveTo(w/2,12);ctx.lineTo(w/2,h-12);ctx.stroke();ctx.beginPath();ctx.arc(w/2,h/2,33,0,Math.PI*2);ctx.stroke();
    const map=(p)=>[12+(p.x+PITCH.halfL)/PITCH.length*(w-24),12+(p.z+PITCH.halfW)/PITCH.width*(h-24)];
    for(const p of this.players){if(!p.active)continue;const[x,y]=map(p.mesh.position);ctx.beginPath();ctx.fillStyle=p.team==='home'?'#55a1ff':'#ff5b6c';ctx.arc(x,y,p===this.controlled?6:4.5,0,Math.PI*2);ctx.fill();if(p===this.controlled){ctx.strokeStyle='#fff46a';ctx.lineWidth=2;ctx.stroke();}}
    const[x,y]=map(this.ball.mesh.position);ctx.beginPath();ctx.fillStyle='#fff';ctx.arc(x,y,3.5,0,Math.PI*2);ctx.fill();
  }

  showStatus(text,seconds=1.2){this.ui.status.textContent=text;this.ui.status.classList.add('visible');this.statusTimer=seconds;}
  flashHint(text){this.ui.hint.textContent=text;this.ui.hint.classList.add('visible');clearTimeout(this.hintTimeout);this.hintTimeout=setTimeout(()=>this.ui.hint.classList.remove('visible'),850);}
  addEvent(title,detail=''){
    this.events.unshift({title,detail,time:performance.now()});this.events=this.events.slice(0,4);
    this.ui.feed.innerHTML=this.events.map(e=>`<div class="event">${e.title}${e.detail?`<small>${e.detail}</small>`:''}</div>`).join('');
  }

  resize(){this.camera.aspect=innerWidth/innerHeight;this.camera.updateProjectionMatrix();this.renderer.setSize(innerWidth,innerHeight);this.renderer.setPixelRatio(Math.min(devicePixelRatio,2));}
  render(){this.renderer.render(this.scene,this.camera);}
  dispose(){this.renderer.dispose();}
}
