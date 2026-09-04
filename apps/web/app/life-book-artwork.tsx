/** Original procedural artwork. No remote media, personal imagery or animated canvas. */
export function LifeTree({ className = '' }: { className?: string }) {
  return <svg className={className} viewBox="0 0 240 240" fill="none" aria-hidden="true">
    <g stroke="currentColor" strokeLinecap="round" strokeLinejoin="round">
      <path d="M120 215V69m0 103-42-39m42 13 43-42m-43 17-29-32m29 7 24-29M120 203l-32 16m32-16 35 17M120 185l-16 29" strokeWidth="3" />
      <path d="m78 133-23-7m23 7-7-25m92-4 22-12m-22 12 2-27m-74 12-22-6m22 6-6-23m59 1 20-12m-20 12 1-22m-25 24-11-23m11 23 12-30" strokeWidth="2" />
      {[ [51,121,-35],[68,99,15],[62,78,-55],[82,58,0],[105,37,-25],[135,30,30],[150,39,30],[171,49,60],[171,69,10],[194,87,65],[186,118,80],[61,146,-65],[93,122,-25],[140,134,50],[111,80,-10] ].map(([x,y,r],i) => <path key={i} d="M0 0C-14-7-13-19 0-26C13-19 14-7 0 0Z" transform={`translate(${x} ${y}) rotate(${r})`} strokeWidth="1.4" />)}
      <path d="M42 205c-21-31-27-68-14-103M198 205c21-31 27-68 14-103" strokeWidth=".8" />
    </g>
  </svg>;
}

export function LifeBookArtwork() {
  return <div className="book-scene" aria-label="Деревянная Книга жизни с деревом воспоминаний">
    <svg className="forest-scene" viewBox="0 0 600 650" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
      <defs><radialGradient id="forest-light"><stop stopColor="#efe2a8" /><stop offset="1" stopColor="#82947b" /></radialGradient></defs>
      <rect width="600" height="650" rx="280" fill="url(#forest-light)" />
      <g fill="none" stroke="#536f5a" opacity=".3" strokeWidth="12"><path d="M63 600 99 0m-17 250L8 156m82 17 69-96M203 640 182 0m9 275 68-115M389 650 415 0m-20 346 126-156M559 630 508 0m24 320-80-100" /></g>
      <g fill="none" stroke="#254e3b" opacity=".65" strokeWidth="19"><path d="M10 650 49 35m-23 417 88-126m-70-78L0 172M604 650 554 48m26 342-90-104m76-66 40-61" /></g>
      <g fill="#42684b" opacity=".55"><ellipse cx="54" cy="98" rx="91" ry="53" /><ellipse cx="512" cy="117" rx="95" ry="56" /><ellipse cx="107" cy="11" rx="146" ry="59" /></g>
      <path d="M0 604Q181 521 322 611T600 585V650H0Z" fill="#5f7658" opacity=".5" />
    </svg>
    <div className="book-rest" />
    <article className="book-cover">
      <div className="book-cover-top"><span>КтоЯ</span><span>Книга жизни</span></div>
      <LifeTree className="cover-tree" />
      <div className="book-title"><span>Истории,</span><span>которые важно</span><span>сохранить</span></div>
      <div className="cover-byline">Написана твоим голосом</div>
      <p className="book-caption">Не идеальная биография.<br />Живая и настоящая жизнь.</p>
      <span className="book-ribbon" aria-hidden="true" />
    </article>
  </div>;
}
