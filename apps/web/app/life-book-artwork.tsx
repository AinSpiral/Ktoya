import { ForestGround } from './forest-scene';

/** Original copperplate-style tree: trunk, roots and individual memory branches. */
export function LifeTree({ className = '' }: { className?: string }) {
  return <svg className={className} viewBox="0 0 260 270" fill="none" aria-hidden="true">
    <circle cx="130" cy="117" r="100" stroke="currentColor" strokeWidth=".6" opacity=".45"/>
    <circle cx="130" cy="117" r="96" stroke="currentColor" strokeWidth=".35" opacity=".3"/>
    <g stroke="currentColor" strokeLinecap="round" strokeLinejoin="round">
      <path d="M120 220C132 177 114 157 127 120C139 97 125 67 137 37M120 220Q150 182 133 137Q131 122 148 97M123 200C106 169 86 173 76 141M129 174C149 161 170 164 183 137M130 147C100 127 99 110 72 95M129 120C153 116 163 83 188 83M131 102Q107 85 112 52" strokeWidth="3"/>
      <path d="M76 141 52 128 43 109M76 141Q82 119 64 110M183 137Q186 116 209 109M183 137 209 136 219 124M72 95 54 94 47 79M72 95Q67 67 82 54M148 97 150 71 167 51M188 83 207 66M112 52 100 39M137 61 151 38M101 123 105 98M98 169 85 184M159 161 169 181" strokeWidth="1.5"/>
      <path d="M120 220C99 222 102 232 72 229M120 220C102 236 92 236 88 249M120 220C117 238 100 235 108 257M126 221C138 236 155 229 170 246M126 221C146 221 148 235 186 231M126 221C126 243 140 242 137 261M108 232 89 229M148 233 158 252M129 242 122 253M96 240 78 243" strokeWidth="1.7"/>
      {Array.from({length:48},(_,i)=>{
        const angle=(i*137.508)*Math.PI/180, radius=25+Math.sqrt(i/48)*65;
        const x=130+Math.cos(angle)*radius, y=110+Math.sin(angle)*radius*.83;
        return <g key={i} transform={`translate(${x.toFixed(2)} ${y.toFixed(2)}) rotate(${i*73%180-90})`}><path d="M0 0C-8-3-9-11-2-18C6-15 9-7 0 0Z" fill="currentColor" fillOpacity=".14" strokeWidth=".7"/><path d="M0 1-2-14m1 8-4-4" strokeWidth=".45"/></g>;
      })}
      <path d="M124 215Q136 188 128 160M128 143 131 130M127 116Q136 95 132 86" strokeWidth=".7" opacity=".6"/>
    </g>
  </svg>;
}

function WalnutSurface() {
  return <svg className="walnut-surface" viewBox="0 0 400 560" preserveAspectRatio="none" aria-hidden="true">
    <defs>
      <linearGradient id="walnut-light" x1="0" y1="0" x2="1" y2=".8"><stop stopColor="#9b7749"/><stop offset=".26" stopColor="#70492e"/><stop offset=".57" stopColor="#4b2e20"/><stop offset=".8" stopColor="#69472e"/><stop offset="1" stopColor="#2d221a"/></linearGradient>
      <filter id="walnut-fibre" x="0" y="0" width="100%" height="100%"><feTurbulence type="fractalNoise" baseFrequency=".18 .009" numOctaves="3" seed="31"/><feColorMatrix type="saturate" values="0"/><feComponentTransfer><feFuncA type="linear" slope=".19"/></feComponentTransfer><feBlend in="SourceGraphic" mode="soft-light"/></filter>
      <radialGradient id="wood-wear" cx=".05" cy=".04" r="1"><stop stopColor="#f4d19a" stopOpacity=".27"/><stop offset=".5" stopColor="#d3a66e" stopOpacity="0"/><stop offset="1" stopColor="#1f180f" stopOpacity=".24"/></radialGradient>
    </defs>
    <rect width="400" height="560" rx="9" fill="url(#walnut-light)" filter="url(#walnut-fibre)"/>
    <g fill="none">{Array.from({length:62},(_,i)=>{
      const x=i*6.7, bend=9+Math.sin(i*1.9)*14;
      return <path key={i} d={`M${x} -15C${x-bend} 100 ${x+bend*2} 168 ${x+bend} 260S${x-bend*2} 428 ${x+3} 585`} stroke={i%4?'#25190e':'#edc795'} strokeWidth={i%4?.45:1} opacity={i%4?.28:.12}/>;
    })}</g>
    <g fill="none" stroke="#3b2617" opacity=".3">{[0,1,2,3].map(i=><path key={i} d={`M${316-i*3} ${95-i*18}C${287-i*4} ${123-i*4} ${284-i*4} ${157+i*5} ${316-i*2} ${188+i*18}C${337+i*2} 165 ${342+i*3} 120 ${316-i*3} ${95-i*18}Z`} strokeWidth=".65"/>)}</g>
    <rect width="400" height="560" rx="9" fill="url(#wood-wear)"/>
    <rect x="2" y="2" width="396" height="556" rx="8" fill="none" stroke="#d5b580" strokeOpacity=".38" strokeWidth="2"/>
  </svg>;
}

export function LifeBookArtwork() {
  return <div className="book-scene" aria-hidden="true">
    <ForestGround />
    <div className="book-contact-shadow"/>
    <div className="heirloom-book">
      <div className="book-back-board"/><div className="book-page-block"/>
      <div className="book-spine"><span>Книга жизни</span><i/><i/><i/></div>
      <article className="book-cover">
      <WalnutSurface /><div className="book-inlay"/>
      <span className="brass-corner corner-top"/><span className="brass-corner corner-bottom"/>
      <div className="book-cover-top"><span className="engraved-brand">КтоЯ</span><span>Книга жизни</span></div>
      <LifeTree className="cover-tree" />
      <div className="book-title"><span>Истории,</span><span>которые важно</span><span>сохранить</span></div>
      <div className="cover-byline">Написана твоим голосом</div>
      <p className="book-caption">Не идеальная биография.<br />Живая и настоящая жизнь.</p>
      </article>
      <span className="book-ribbon"/>
    </div>
    <span className="scene-edition">Твои воспоминания. Твой голос. Навсегда.</span>
  </div>;
}
