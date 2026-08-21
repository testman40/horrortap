// ==========================================================
// ジャストタップ ホラー(プロトタイプ)
// タップ対象が一瞬光ったらタップ。ハズレ(手形)はタップ禁止。
// ==========================================================

const game = document.getElementById('game');
const bgTitle = document.getElementById('bgTitle');
const bg = document.getElementById('bg');
const loadingScreen = document.getElementById('loadingScreen');
const loadingBarInner = document.getElementById('loadingBarInner');
const loadingCount = document.getElementById('loadingCount');
const targetCorrect = document.getElementById('targetCorrect');
const targetWrong = document.getElementById('targetWrong');
const ring = document.getElementById('ring');
const effect = document.getElementById('effect');
const uiCanvas = document.getElementById('ui');
const ctx = uiCanvas.getContext('2d');
const bgmMain = document.getElementById('bgmMain');
const bgmTension = document.getElementById('bgmTension');
const startScreen = document.getElementById('startScreen');
const endScreen = document.getElementById('endScreen');
const startBtn = document.getElementById('startBtn');
const retryBtn = document.getElementById('retryBtn');
const finalScoreEl = document.getElementById('finalScore');
const jumpscare = document.getElementById('jumpscare');
const jumpscareVideo = document.getElementById('jumpscareVideo');

// ---- 効果音(Web Audio APIで合成。音声ファイルは使わない) ----
let audioCtx = null;

function initAudioContext() {
  if (!audioCtx) {
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  }
  if (audioCtx.state === 'suspended') {
    audioCtx.resume();
  }
}

// 汎用トーン生成:type=波形, freq=周波数, duration=秒, volume=音量, delay=開始遅延(秒)
function playTone(type, freq, duration, volume, delay = 0) {
  if (!audioCtx) return;
  const osc = audioCtx.createOscillator();
  const gain = audioCtx.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, audioCtx.currentTime + delay);
  gain.gain.setValueAtTime(0, audioCtx.currentTime + delay);
  gain.gain.linearRampToValueAtTime(volume, audioCtx.currentTime + delay + 0.01);
  gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + delay + duration);
  osc.connect(gain);
  gain.connect(audioCtx.destination);
  osc.start(audioCtx.currentTime + delay);
  osc.stop(audioCtx.currentTime + delay + duration);
}

// タップ成功音:コンボ数に応じてピッチが少しずつ上がる(明るい二音上昇)
function playSuccessSE(comboCount) {
  const tier = Math.floor((comboCount - 1) / 5); // 5コンボごとに音程が一段上がる
  const base = 880 * Math.pow(1.12, tier);
  playTone('sine', base, 0.12, 0.25, 0);
  playTone('sine', base * 1.5, 0.15, 0.2, 0.06);

  // 5コンボ達成ごとに、通常音に重ねて特別なジングルを鳴らす
  if (comboCount > 0 && comboCount % 5 === 0) {
    playComboMilestoneSE(tier);
  }
}

// コンボ5の倍数到達時のジングル:短い上昇アルペジオ
function playComboMilestoneSE(tier) {
  const root = 660 * Math.pow(1.15, tier);
  playTone('triangle', root, 0.1, 0.22, 0.08);
  playTone('triangle', root * 1.25, 0.1, 0.22, 0.17);
  playTone('triangle', root * 1.5, 0.18, 0.25, 0.26);
}

// ゲームオーバー演出:シルエット出現の瞬間に鳴らす低い不協和音
function playJumpscareSting() {
  playTone('sawtooth', 55, 0.9, 0.3, 0);
  playTone('sawtooth', 58, 0.9, 0.25, 0);
  playTone('square', 830, 0.15, 0.15, 0);
}

// タップ失敗音:低く濁った下降音(ブブッ)
function playFailSE() {
  playTone('sawtooth', 180, 0.22, 0.18, 0);
  playTone('sawtooth', 110, 0.28, 0.15, 0.05);
}

// 赤フラッシュ用の要素を動的に追加
const flash = document.createElement('div');
flash.id = 'flash';
game.appendChild(flash);

// ---- ゲーム状態 ----
let score = 0;
let combo = 0;
let lives = 3;
let running = false;
let spawnTimer = null;
let judgeTimer = null;
let currentType = null; // 'correct' or 'wrong'

// タップ猶予(ミリ秒)。スコアが伸びるほど短くする
const BASE_WINDOW = 1400;
const MIN_WINDOW = 650;

// ゲーム中の舞台候補(プレイのたびにランダムで1つ選ばれる)
const STAGES = [
  'assets/bg_hallway_dark_01.mp4',
  'assets/bg_tatami_dark_01.mp4',
  'assets/bg_hospital_corridor_01.mp4',
  'assets/bg_stairwell_dark_01.mp4',
  'assets/bg_forest_path_01.mp4',
];

function pickRandomStage() {
  return STAGES[Math.floor(Math.random() * STAGES.length)];
}

// ---- 素材の事前読み込み ----
// タイトル背景・タップ対象・エフェクト・リング・BGM2種・全ステージ背景を先に読み込み、
// 完了するまでタイトル画面(ルール説明・スタートボタン)を表示しない。
const ASSET_LIST = [
  'assets/bg_title_door_01.mp4',
  'assets/target_correct_cross_light.mp4',
  'assets/target_wrong_handprint.mp4',
  'assets/ui_ring_frame.mp4',
  'assets/effect_success_burst.mp4',
  'assets/bgm_main_loop.mp3',
  'assets/bgm_tension_rise.mp3',
  'assets/whitehand.mp4',
  ...STAGES,
];

function preloadAssets() {
  const total = ASSET_LIST.length;
  let loaded = 0;
  loadingCount.textContent = `0 / ${total}`;

  const promises = ASSET_LIST.map((url) =>
    fetch(url)
      .then((res) => res.blob())
      .catch(() => null) // 読み込み失敗しても全体を止めない
      .finally(() => {
        loaded += 1;
        const pct = Math.round((loaded / total) * 100);
        loadingBarInner.style.width = pct + '%';
        loadingCount.textContent = `${loaded} / ${total}`;
      })
  );

  Promise.all(promises).then(() => {
    loadingScreen.classList.add('hidden');
    startScreen.classList.remove('hidden');
    bgTitle.play();
  });
}

function resizeCanvas() {
  uiCanvas.width = game.clientWidth;
  uiCanvas.height = game.clientHeight;
}
window.addEventListener('resize', resizeCanvas);

function currentWindow() {
  return Math.max(MIN_WINDOW, BASE_WINDOW - score * 30);
}

function drawUI() {
  ctx.clearRect(0, 0, uiCanvas.width, uiCanvas.height);
  ctx.fillStyle = '#eee';
  ctx.font = '18px sans-serif';
  ctx.textAlign = 'left';
  ctx.fillText(`SCORE: ${score}`, 16, 32);
  ctx.fillText(`COMBO: ${combo}`, 16, 56);

  // 残機表示(左上に手形アイコン代わりの丸)
  ctx.textAlign = 'right';
  ctx.fillStyle = '#c33';
  for (let i = 0; i < lives; i++) {
    ctx.beginPath();
    ctx.arc(uiCanvas.width - 20 - i * 24, 24, 7, 0, Math.PI * 2);
    ctx.fill();
  }
}

function randomPos() {
  // 画面の中央寄りにランダム配置(端すぎるとタップしづらいため)
  const x = 25 + Math.random() * 50; // %
  const y = 30 + Math.random() * 40; // %
  return { x, y };
}

function placeAt(el, pos) {
  el.style.left = pos.x + '%';
  el.style.top = pos.y + '%';
}

function spawnTarget() {
  if (!running) return;

  const isCorrect = Math.random() > 0.35; // ハズレを一定確率で混ぜる
  currentType = isCorrect ? 'correct' : 'wrong';
  const pos = randomPos();
  const el = isCorrect ? targetCorrect : targetWrong;

  placeAt(el, pos);
  placeAt(ring, pos);

  el.currentTime = 0;
  ring.currentTime = 0;
  el.play();
  ring.play();
  el.classList.add('active');
  ring.classList.add('active');

  const windowMs = currentWindow();

  judgeTimer = setTimeout(() => {
    // 猶予時間内にタップされなかった場合
    hideTarget(el);
    if (currentType === 'correct') {
      onMiss(); // 正解を取り逃した
    }
    scheduleNextSpawn();
  }, windowMs);
}

function hideTarget(el) {
  el.classList.remove('active');
  ring.classList.remove('active');
  el.pause();
}

function scheduleNextSpawn() {
  if (!running) return;
  const gap = 500 + Math.random() * 700;
  spawnTimer = setTimeout(spawnTarget, gap);
}

function onHitCorrect() {
  clearTimeout(judgeTimer);
  hideTarget(targetCorrect);
  score += 1;
  combo += 1;
  playEffect();
  playSuccessSE(combo);

  // コンボが伸びたらBGMを緊張モードへ切り替え
  if (combo === 5) {
    switchBgm(bgmTension);
  }

  scheduleNextSpawn();
}

function onHitWrong() {
  clearTimeout(judgeTimer);
  hideTarget(targetWrong);
  onMiss();
  scheduleNextSpawn();
}

function onMiss() {
  combo = 0;
  lives -= 1;
  flashRed();
  playFailSE();
  if (lives <= 0) {
    endGame();
  }
}

function playEffect() {
  const pos = { left: targetCorrect.style.left, top: targetCorrect.style.top };
  effect.style.left = pos.left;
  effect.style.top = pos.top;
  effect.currentTime = 0;
  effect.classList.add('active');
  effect.play();
  setTimeout(() => effect.classList.remove('active'), 600);
}

function flashRed() {
  flash.style.opacity = '0.5';
  setTimeout(() => (flash.style.opacity = '0'), 150);
}

function switchBgm(target) {
  [bgmMain, bgmTension].forEach((a) => {
    if (a !== target) {
      a.pause();
    }
  });
  target.currentTime = 0;
  target.play();
}

// ---- タップ判定 ----
targetCorrect.addEventListener('pointerdown', (e) => {
  e.stopPropagation();
  onHitCorrect();
});
targetWrong.addEventListener('pointerdown', (e) => {
  e.stopPropagation();
  onHitWrong();
});

// ---- ゲーム開始/終了 ----
function startGame() {
  initAudioContext();
  score = 0;
  combo = 0;
  lives = 3;
  running = true;
  startScreen.classList.add('hidden');
  endScreen.classList.add('hidden');
  resizeCanvas();

  // タイトル背景を止めて、ランダムに選んだステージ背景へ切り替え
  bgTitle.classList.remove('active');
  bgTitle.pause();

  bg.src = pickRandomStage();
  bg.currentTime = 0;
  bg.classList.add('active');
  bg.play();

  switchBgm(bgmMain);
  scheduleNextSpawn();
  loop();
}

function endGame() {
  running = false;
  clearTimeout(spawnTimer);
  clearTimeout(judgeTimer);
  hideTarget(targetCorrect);
  hideTarget(targetWrong);
  bgmMain.pause();
  bgmTension.pause();
  playJumpscareSequence();
}

// ゲームオーバー演出:女性が後ろ姿で近づいてくる映像をコマ送り再生 → 暗転 → 結果画面
const JUMPSCARE_FRAME_STEP = 0.6;     // 1コマで進める秒数(大きいほどワープ感が強い)
const JUMPSCARE_STEP_INTERVAL = 220;  // コマ送りの間隔(ミリ秒。小さいほど速く進む)

function playJumpscareSequence() {
  jumpscare.classList.remove('hidden');
  jumpscareVideo.pause();
  jumpscareVideo.classList.add('active');

  let finished = false;
  let stepTimer = null;

  const finish = () => {
    if (finished) return;
    finished = true;
    clearInterval(stepTimer);
    clearTimeout(fallbackTimer);
    jumpscareVideo.removeEventListener('loadedmetadata', startStepping);
    finishJumpscare();
  };

  // 動画が読み込めない等のトラブルに備え、最大4秒で強制的に先へ進む保険
  const fallbackTimer = setTimeout(finish, 4000);

  function startStepping() {
    const duration = jumpscareVideo.duration && isFinite(jumpscareVideo.duration)
      ? jumpscareVideo.duration
      : 4;
    let pos = 0;

    try {
      jumpscareVideo.currentTime = 0;
    } catch (e) {
      // 読み込み状況によっては失敗することがあるが無視して進める
    }

    stepTimer = setInterval(() => {
      pos += JUMPSCARE_FRAME_STEP;
      if (pos >= duration) {
        finish();
        return;
      }
      try {
        jumpscareVideo.currentTime = pos;
      } catch (e) {
        // シークに失敗しても次のコマ送りは継続する
      }
    }, JUMPSCARE_STEP_INTERVAL);
  }

  if (jumpscareVideo.readyState >= 1) {
    // すでに尺情報(メタデータ)が読み込み済みならすぐ開始
    startStepping();
  } else {
    jumpscareVideo.addEventListener('loadedmetadata', startStepping, { once: true });
  }
}

function finishJumpscare() {
  // コマ送りの最後の瞬間に、低い不協和音を鳴らして緊張を最大化する
  playJumpscareSting();

  // 少し静止させてから暗転し、結果画面へ
  setTimeout(() => {
    jumpscareVideo.classList.remove('active');
    jumpscareVideo.pause();
    setTimeout(showResult, 400);
  }, 500);
}

function showResult() {
  jumpscare.classList.add('hidden');
  finalScoreEl.textContent = `スコア: ${score}`;
  endScreen.classList.remove('hidden');

  // ゲーム背景を止めてタイトル背景に戻す
  bg.classList.remove('active');
  bg.pause();
  bgTitle.classList.add('active');
  bgTitle.play();
}

function loop() {
  if (!running) return;
  drawUI();
  requestAnimationFrame(loop);
}

startBtn.addEventListener('click', startGame);
retryBtn.addEventListener('click', startGame);

resizeCanvas();

// 初期表示:タイトル背景を再生対象に設定(実際の再生は素材読み込み完了後)
bgTitle.classList.add('active');

// 素材の事前読み込みを開始
preloadAssets();

// ---------- 素材の簡易的な持ち出し防止(右クリック保存・ドラッグ保存の抑止) ----------
document.addEventListener('contextmenu', (e) => e.preventDefault());
document.addEventListener('dragstart', (e) => e.preventDefault());
