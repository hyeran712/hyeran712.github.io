import { Uniform } from 'three'
import { Effect } from 'postprocessing'

const fragment = /* glsl */ `
uniform float strength;
void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
  vec2 dir = uv - vec2(0.5, 0.42);
  float d = length(dir);
  float amt = strength * smoothstep(0.22, 0.8, d);
  if (amt < 0.0005) { outputColor = inputColor; return; }
  vec4 acc = inputColor;
  for (int i = 1; i < 7; i++) acc += texture2D(inputBuffer, uv - dir * amt * float(i) / 6.0);
  outputColor = acc / 7.0;
}`

/** Subtle radial blur towards the screen edges that grows with speed. */
export class SpeedBlurEffect extends Effect {
  constructor() {
    super('SpeedBlurEffect', fragment, { uniforms: new Map([['strength', new Uniform(0)]]) })
  }
  set strength(v: number) { this.uniforms.get('strength')!.value = v }
}
