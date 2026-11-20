/** WebGL ES adaptation of MIDIVisualizer halo/fade equations.
 * Copyright (c) 2020 Simon Rodriguez. MIT; see third-party/MIDIVisualizer/LICENSE.
 * Panthesia uses analytic sprites and its own geometry, without upstream textures.
 */
export const strikeVertex = `#version 300 es
precision highp float;
layout(location=0) in vec2 corner;
layout(location=1) in vec4 rect;
layout(location=2) in vec4 tint;
layout(location=3) in vec2 shape;
uniform vec2 viewport;
out vec2 uv;
out vec4 color;
flat out float kind;
out float phase;
void main(){
  vec2 pixel=rect.xy+corner*rect.zw;
  gl_Position=vec4(pixel/viewport*vec2(2.0,-2.0)+vec2(-1.0,1.0),0.0,1.0);
  uv=corner; color=tint; kind=shape.x; phase=shape.y;
}`;
export const strikeFragment = `#version 300 es
precision highp float;
in vec2 uv;
in vec4 color;
flat in float kind;
in float phase;
out vec4 fragColor;
void main(){
  vec2 p=uv*2.0-1.0;
  float radius=length(p);
  // MIDIVisualizer flashes.frag: smooth inner/outer halo, premultiplied output.
  float halo=1.0-smoothstep(0.05,1.0,radius);
  float mask=halo*halo;
  if(kind>0.5&&kind<1.5){
    float ring=abs(radius-(0.28+0.55*phase));
    mask=exp(-ring*ring*650.0)*(1.0-phase);
  }else if(kind>1.5&&kind<2.5){
    float star=exp(-18.0*dot(p,p))+0.25*exp(-abs(p.x)*22.0-abs(p.y)*3.0);
    mask=min(1.0,star);
  }else if(kind>2.5&&kind<3.5){
    mask=exp(-p.x*p.x*7.0)*uv.y*uv.y;
  }else if(kind>3.5){
    mask=exp(-p.x*p.x*12.0)*pow(uv.y,1.7);
  }
  float alpha=clamp(mask*color.a,0.0,1.0);
  fragColor=vec4(mix(color.rgb,vec3(1.0),mask*0.28)*alpha,alpha);
}`;
