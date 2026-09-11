'use client';

import { useState } from 'react';
import { ForestBackdrop } from './forest-scene';
import { LifeBookArtwork } from './life-book-artwork';

const ROOT = '/art/life-book/';
const desktop = (format: string) => `${ROOT}forest-desktop-1200.${format} 1200w, ${ROOT}forest-desktop-1584.${format} 1584w`;
const mobile = (format: string) => `${ROOT}forest-mobile-768.${format} 768w, ${ROOT}forest-mobile-1024.${format} 1024w`;
const book = (format: string) => `${ROOT}book-560.${format} 560w, ${ROOT}book-1120.${format} 1120w`;
const BOOK_SIZES = '(max-width: 600px) 281px, (max-width: 900px) 393px, (max-width: 1199px) 371px, 494px';

export function HybridForestBackdrop() {
  const [ready, setReady] = useState(false);
  return <>
    <link rel="preload" as="image" type="image/avif" media="(min-width: 901px)" imageSrcSet={desktop('avif')} imageSizes="100vw" />
    <link rel="preload" as="image" type="image/avif" media="(max-width: 900px)" imageSrcSet={mobile('avif')} imageSizes="100vw" />
    <div className="hybrid-forest" data-ready={ready} aria-hidden="true">
      <picture>
        <source media="(max-width: 900px)" type="image/avif" srcSet={mobile('avif')} sizes="100vw" />
        <source media="(max-width: 900px)" type="image/webp" srcSet={mobile('webp')} sizes="100vw" />
        <source type="image/avif" srcSet={desktop('avif')} sizes="100vw" />
        {/* Native picture is intentional: responsive art direction and transparent source ownership. */}
        <img src={`${ROOT}forest-desktop-1200.webp`} srcSet={desktop('webp')} sizes="100vw" width="1586" height="992" alt="" fetchPriority="high" loading="eager" onLoad={() => setReady(true)} onError={() => setReady(false)} />
      </picture>
    </div>
    <ForestBackdrop />
  </>;
}

export function HybridBookArtwork() {
  const [ready, setReady] = useState(false);
  return <div className="hybrid-book-slot" data-ready={ready}>
    {!ready && <LifeBookArtwork />}
    <div className="book-scene hybrid-book-scene" aria-hidden="true" hidden={!ready}>
      <div className="hybrid-contact" />
      <div className="raster-book-object">
        <div className="book-master-plane">
          <picture>
            <source type="image/avif" srcSet={book('avif')} sizes={BOOK_SIZES} />
            <img src={`${ROOT}book-560.webp`} srcSet={book('webp')} sizes={BOOK_SIZES} width="1122" height="1402" alt="" fetchPriority="high" loading="eager" onLoad={() => setReady(true)} onError={() => setReady(false)} />
          </picture>
          <article className="book-cover hybrid-cover-plane" style={{ transform: 'matrix3d(0.907789524,0.053273735,0,-0.000042045,0.007694602,1.006937953,0,0.000009502,0,0,1,0,240,85,0,1)' }}>
            <span className="hybrid-engraved-brand">КтоЯ</span>
            <span className="hybrid-cover-label">Книга жизни</span>
            <p className="hybrid-cover-title">Истории,<br />которые важно<br />сохранить</p>
            <p className="book-caption">Не идеальная биография.<br />Живая и настоящая жизнь.</p>
          </article>
        </div>
      </div>
    </div>
  </div>;
}
