import './style.css';
import { Input } from './game/Input.js';
import { FootballGame } from './game/FootballGame.js';

const app = document.querySelector('#app');
const input = new Input();
const game = new FootballGame(app, input);

let last = performance.now();
function frame(now) {
  const dt = Math.min((now - last) / 1000, 1 / 30);
  last = now;
  game.update(dt);
  input.endFrame();
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

window.game = game;
