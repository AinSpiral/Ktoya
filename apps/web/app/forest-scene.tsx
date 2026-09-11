'use client';

import { useEffect, useRef } from 'react';

// Original, deterministic botanical drawing. Fixed seeds keep SSR and hydration equal.
const wave = (seed: number) => (Math.sin(seed * 127.1 + 311.7) * 43758.5453) % 1;
const unit = (seed: number) => Math.abs(wave(seed));

function WoodlandTree({ x, base, height, width, seed, tone }: { x: number; base: number; height: number; width: number; seed: number; tone: string }) {
  const lean = (unit(seed) - .5) * 100;
  const top = x + lean;
  return <g fill={tone}>
    <path d={`M${x-width} ${base} Q${x+width*.15} ${base-height*.44} ${top-width*.18} ${base-height} L${top+width*.12} ${base-height} Q${x+width*.45} ${base-height*.4} ${x+width} ${base}Z`} />
    {Array.from({ length: 3 }, (_, i) => {
      const level = .48 + i * .17 + unit(seed + i) * .07;
      const y = base - height * level;
      const origin = x + lean * level;
      const direction = (i % 2 ? 1 : -1);
      const length = height * (.09 + unit(seed+i) * .1);
      return <g key={i} stroke={tone} fill="none" strokeLinecap="round">
        <path d={`M${origin} ${y+32}C${origin+direction*length*.65} ${y+10} ${origin+direction*length*.34} ${y-length*.42} ${origin+direction*length} ${y-length*.5}C${origin+direction*length*.62} ${y-length*.53} ${origin+direction*length*.51} ${y+29} ${origin} ${y+32+width*.4}Z`} fill={tone} strokeWidth=".5" />
        <path d={`M${origin+direction*length*.6} ${y-length*.3}q${-direction*10} -18 ${direction*13} -40 M${origin+direction*length*.9} ${y-length*.46}q${direction*18} 5 ${direction*31} -8`} strokeWidth={Math.max(.6,width*.06)} />
      </g>;
    })}
    <path d={`M${x-width*.22} ${base-15} Q${x+width*.38} ${base-height*.35} ${top} ${base-height*.91}`} stroke="#b7b698" strokeOpacity=".12" strokeWidth={Math.max(1,width*.13)} fill="none" />
  </g>;
}

/** Four spatial planes and local foliage; all decoration is inert. */
export function ForestBackdrop() {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const host = ref.current?.parentElement;
    if (!host) return;
    const preference = window.matchMedia('(prefers-reduced-motion: no-preference) and (hover: hover) and (pointer: fine)');
    const reset = () => { host.style.setProperty('--forest-x', '0px'); host.style.setProperty('--forest-y', '0px'); };
    const move = (event: PointerEvent) => {
      if (!preference.matches || event.pointerType !== 'mouse') return;
      const rect = host.getBoundingClientRect();
      const clamp = (value: number) => Math.max(-1, Math.min(1, value));
      host.style.setProperty('--forest-x', `${clamp((event.clientX-rect.left)/rect.width*2-1)*6}px`);
      host.style.setProperty('--forest-y', `${clamp((event.clientY-rect.top)/rect.height*2-1)*4}px`);
    };
    host.addEventListener('pointermove', move, { passive: true });
    host.addEventListener('pointerleave', reset);
    preference.addEventListener('change', reset);
    return () => { host.removeEventListener('pointermove', move); host.removeEventListener('pointerleave', reset); preference.removeEventListener('change', reset); reset(); };
  }, []);
  return <div className="forest-world" ref={ref} aria-hidden="true">
    <svg className="forest-plane forest-far" viewBox="0 0 1600 1000" preserveAspectRatio="xMidYMid slice">
      <defs>
        <linearGradient id="forest-distance" x2="0" y2="1"><stop stopColor="#536c62"/><stop offset=".5" stopColor="#81958b"/><stop offset="1" stopColor="#233b31"/></linearGradient>
        <radialGradient id="forest-clearing"><stop stopColor="#f2dba2" stopOpacity=".64"/><stop offset=".42" stopColor="#c3c6a3" stopOpacity=".22"/><stop offset="1" stopColor="#91afa5" stopOpacity="0"/></radialGradient>
        <filter id="forest-grain" x="0" y="0" width="100%" height="100%"><feTurbulence type="fractalNoise" baseFrequency=".035 .065" numOctaves="3" seed="18"/><feColorMatrix type="saturate" values="0"/><feComponentTransfer><feFuncA type="linear" slope=".12"/></feComponentTransfer><feBlend in="SourceGraphic" mode="soft-light"/></filter>
      </defs>
      <rect width="1600" height="1000" fill="url(#forest-distance)"/>
      {Array.from({length:26},(_,i)=><WoodlandTree key={i} x={i*70-80+unit(i+10)*39} base={850+unit(i+5)*60} height={730+unit(i+20)*260} width={4+unit(i)*10} seed={i+20} tone={i%2?'#617c70':'#49665b'}/>)}
      {Array.from({length:34},(_,i)=>{
        const x=unit(i+900)*1740-80, y=unit(i+960)*370-160, size=60+unit(i+1000)*130;
        return <path key={`crown-${i}`} d={`M${x-size} ${y}q${-size*.3} ${-size*.6} ${size*.4} ${-size*.65}q0 ${-size*.7} ${size*.6} ${-size*.3}q${size*.5} ${-size*.65} ${size*.8} 0q${size*.8} 0 ${size*.35} ${size*.75}q${size*.2} ${size*.55} ${-size*.65} ${size*.5}q${-size*.6} ${size*.35} ${-size*1.5} ${-size*.3}Z`} fill={i%2?'#3a5b49':'#526c56'} opacity={.25+unit(i)*.3}/>;
      })}
      <path d="M930 480C864 626 1050 684 800 802S650 892 1100 1000H1600C1120 798 1150 670 930 480Z" fill="#bac3a2" opacity=".11"/>
      <ellipse cx="1110" cy="370" rx="510" ry="500" fill="url(#forest-clearing)"/>
      <rect width="1600" height="1000" fill="transparent" filter="url(#forest-grain)" opacity=".65"/>
    </svg>
    <svg className="forest-plane forest-middle" viewBox="0 0 1600 1000" preserveAspectRatio="xMidYMid slice">
      <defs><linearGradient id="forest-ground" x2="0" y2="1"><stop stopColor="#283f30" stopOpacity="0"/><stop offset="1" stopColor="#17251e"/></linearGradient></defs>
      {[[-25,48,921],[184,23,858],[353,15,852],[572,17,816],[743,23,885],[1348,32,922],[1470,49,990],[1203,11,822]].map(([x,w,b],i)=><WoodlandTree key={i} x={x} base={b} height={1120-i*17} width={w} seed={90+i} tone={i%2?'#2a4438':'#314f41'}/>)}
      <path d="M0 854Q200 750 379 854T724 847Q998 718 1210 842T1600 815V1000H0Z" fill="url(#forest-ground)"/>
      {Array.from({length:80},(_,i)=>{
        const x=unit(i+190)*1600, y=690+unit(i+100)*280;
        return <path key={i} d={`M${x} ${y}q10 -${8+unit(i)*20} 25 -6q-8 -16 18 -20`} stroke={i%3?'#5e7150':'#9eaa76'} strokeWidth={1+unit(i+9)*2} opacity=".18" fill="none"/>;
      })}
    </svg>
    <svg className="forest-plane forest-near" viewBox="0 0 1600 1000" preserveAspectRatio="xMidYMid slice">
      <defs>
        <linearGradient id="near-bark"><stop stopColor="#111f18"/><stop offset=".65" stopColor="#273d2c"/><stop offset=".82" stopColor="#47543a"/><stop offset="1" stopColor="#18271e"/></linearGradient>
        <linearGradient id="forest-leaf" x2=".7" y2="1"><stop stopColor="#869161"/><stop offset=".4" stopColor="#4b6641"/><stop offset="1" stopColor="#1d3928"/></linearGradient>
      <symbol id="woodland-leaf" viewBox="-16 -37 32 40"><path d="M0 2C-7-3-15-10-11-19C-9-25-3-29 0-37C2-29 12-23 12-15C12-7 5-1 0 2Z" fill="url(#forest-leaf)"/><path d="M0 2Q3-15 0-32m1 24-8-7m8 0 8-8M1-19-5-26" stroke="#bbbd88" strokeWidth=".6" opacity=".44" fill="none"/></symbol>
      </defs>
      <path d="M-100 1040Q57 702 3 221L-28-50 52-30Q51 449 140 1020Z M1502 1030Q1590 466 1497-30H1624L1700 1060Z" fill="url(#near-bark)"/>
      {Array.from({length:18},(_,i)=><path key={i} d={`M${-10+i*6} 1000Q${55+i*2} 706 ${i*3-10} ${200+unit(i)*140}M${1550+i*6} 1000Q${1580+i*3} 529 ${1510+i*6} 0`} stroke={i%2?'#9c9870':'#080f0a'} strokeWidth={1+unit(i)*3} opacity=".2" fill="none"/>)}
      <g className="canopy-sway canopy-left"><path d="M-20 174C153 107 180 225 331 115S540 145 675 23M124 150Q146 63 280 17M292 140Q390 229 499 187" stroke="#17291d" strokeWidth="18" fill="none"/>
        {Array.from({length:66},(_,i)=><use key={i} href="#woodland-leaf" width={28+unit(i)*34} height={45+unit(i)*38} x={unit(i+330)*650-50} y={unit(i+470)*220-45} transform={`rotate(${unit(i)*170-85} ${unit(i+330)*650} ${unit(i+470)*220})`} opacity={.5+unit(i+77)*.5}/>)}
      </g>
      <g className="canopy-sway canopy-right"><path d="M1638 67Q1441 191 1337 132T1170 36M1461 154Q1473 265 1369 276" stroke="#152a1e" strokeWidth="16" fill="none"/>
        {Array.from({length:48},(_,i)=><use key={i} href="#woodland-leaf" width={32+unit(i)*26} height={48+unit(i)*35} x={1150+unit(i+81)*460} y={unit(i+150)*240-35} transform={`rotate(${unit(i+53)*180-90} ${1150+unit(i+81)*460} ${unit(i+150)*240})`}/>)}
      </g>
    </svg>
    <div className="forest-light"/>
    <div className="forest-copy-shade"/>
    <div className="forest-air">{[0,1,2,3,4].map(i=><i key={i} style={{left:`${64+i*4}%`,top:`${22+i*9}%`,animationDelay:`-${i*3}s`}}/>)}</div>
  </div>;
}

/** Close ground: roots overlap moss, a cut wood surface supports the book. */
export function ForestGround() {
  return <svg className="book-ground" viewBox="0 0 760 320" aria-hidden="true">
    <defs>
      <linearGradient id="root-wood" x2=".3" y2="1"><stop stopColor="#8c8260"/><stop offset=".18" stopColor="#706447"/><stop offset=".5" stopColor="#494832"/><stop offset="1" stopColor="#28382a"/></linearGradient>
      <linearGradient id="moss-bed" x2="0" y2="1"><stop stopColor="#9d9f64"/><stop offset=".5" stopColor="#4c633d"/><stop offset="1" stopColor="#223728"/></linearGradient>
      <radialGradient id="book-contact"><stop stopColor="#070d09" stopOpacity=".9"/><stop offset="1" stopColor="#0b160f" stopOpacity="0"/></radialGradient>
      <radialGradient id="root-edge" cx=".52" cy=".61" r=".64"><stop offset=".76" stopColor="white"/><stop offset="1" stopColor="black"/></radialGradient>
      <mask id="root-fade"><rect width="760" height="320" fill="url(#root-edge)"/></mask>
    </defs>
    <g mask="url(#root-fade)">
    <ellipse cx="413" cy="186" rx="282" ry="65" fill="url(#book-contact)"/>
    <path d="M16 292C40 254 142 250 202 221S221 172 275 147C317 128 396 138 451 142S565 145 612 180Q640 218 744 252L748 320H5Z" fill="url(#root-wood)"/>
    <path d="M197 222C225 199 264 189 276 166C364 139 497 145 587 172Q491 203 367 192T197 222Z" fill="#726749"/>
    {Array.from({length:22},(_,i)=><path key={i} d={`M${55+i*6} ${303-i*2}C${260+i*5} ${219+i*1.7} ${163+i*5} ${235-i*2} ${258+i*6} ${185+i*.5}Q${381+i*6} ${159+i*1.3} ${609+i*4} ${207+i*2}`} stroke={i%3?'#b6a577':'#18271b'} strokeWidth={i%3?.75:2.5} opacity={i%3?.3:.38} fill="none"/>)}
    <path d="M3 303C174 275 264 267 313 225Q335 205 381 213M578 193C618 208 565 250 669 288M213 276Q205 309 122 321" stroke="#17271c" strokeWidth="18" fill="none"/>
    <path d="M3 297C174 269 264 261 313 219Q335 199 381 207M578 187C618 202 565 244 669 282" stroke="url(#root-wood)" strokeWidth="16" fill="none"/>
    {Array.from({length:210},(_,i)=>{
      const x=75+unit(i+700)*630, y=214+unit(i+800)*100;
      const size=3+unit(i+350)*6;
      return <g key={i} stroke={i%4?'#627749':'#a7a06a'} strokeWidth={.7+unit(i)*1.3} opacity={.3+unit(i)*.6} fill="none"><path d={`M${x} ${y}q-3 -${size} -${size} -${size}m${size} ${size}q-1 -${size*1.4} 2 -${size*1.6}m-2 ${size*1.6}q${size*.6} -${size} ${size} -${size*.65}m-${size} ${size*.65}q-3 -4 -5 -2`}/></g>;
    })}
    <g transform="translate(555 235) rotate(24)"><path d="M0 0C8-20 29-27 51-20C44-1 22 10 0 0Z" fill="#9c8651"/><path d="M-7 3 45-18M10-3 17-17M24-8 37-6" stroke="#493f27" strokeWidth=".9" fill="none"/></g>
    <path d="M84 239q48-18 86 1m-46-8 13-13" stroke="#7f7551" strokeWidth="2" fill="none"/>
    </g>
  </svg>;
}
