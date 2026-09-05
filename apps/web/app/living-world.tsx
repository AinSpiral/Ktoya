'use client';

import { useState } from 'react';
import { ForestBackdrop } from './forest-scene';
import { LifeBookArtwork } from './life-book-artwork';

const ROOT = '/art/living-world/';
const desktop = (format: string) => `${ROOT}hero-desktop-1200.${format} 1200w, ${ROOT}hero-desktop-1584.${format} 1584w`;
const mobile = (format: string) => `${ROOT}hero-mobile-768.${format} 768w, ${ROOT}hero-mobile-1024.${format} 1024w`;
const roots = (format: string) => `${ROOT}ancestry-roots-640.${format} 640w, ${ROOT}ancestry-roots-1200.${format} 1200w`;

export function LivingWorldBackdrop() {
  const [ready, setReady] = useState(false);

  return <>
    <link rel="preload" as="image" type="image/avif" media="(min-width: 901px)" imageSrcSet={desktop('avif')} imageSizes="100vw" />
    <link rel="preload" as="image" type="image/avif" media="(max-width: 900px)" imageSrcSet={mobile('avif')} imageSizes="100vw" />
    <div className="living-world-forest" data-ready={ready} aria-hidden="true">
      <picture>
        <source media="(max-width: 900px)" type="image/avif" srcSet={mobile('avif')} sizes="100vw" />
        <source media="(max-width: 900px)" type="image/webp" srcSet={mobile('webp')} sizes="100vw" />
        <source type="image/avif" srcSet={desktop('avif')} sizes="100vw" />
        <img src={`${ROOT}hero-desktop-1200.webp`} srcSet={desktop('webp')} sizes="100vw" width="1586" height="992" alt="" fetchPriority="high" loading="eager" onLoad={() => setReady(true)} onError={() => setReady(false)} />
      </picture>
    </div>
    <ForestBackdrop />
  </>;
}

export function LivingBookArtwork() {
  return <div className="living-book-zone" aria-hidden="true">
    <div className="living-procedural-fallback"><LifeBookArtwork /></div>
    <article className="living-cover-plane">
      <span className="living-cover-brand">КтоЯ</span>
      <span className="living-cover-label">Книга жизни</span>
      <span className="living-cover-rule" />
      <p>Истории,<br />которые важно<br />сохранить</p>
    </article>
  </div>;
}

export function LivingAncestryImage() {
  return <figure className="living-ancestry-figure">
    <picture>
      <source type="image/avif" srcSet={roots('avif')} sizes="(max-width: 760px) calc(100vw - 40px), 47vw" />
      <img src={`${ROOT}ancestry-roots-640.webp`} srcSet={roots('webp')} sizes="(max-width: 760px) calc(100vw - 40px), 47vw" width="1448" height="1086" loading="lazy" alt="Корни старого дерева и годичные кольца в тёплом лесном свете" />
    </picture>
    <figcaption><span>Корни</span> хранят начало. <span>Кольца</span> — прожитое время.</figcaption>
  </figure>;
}
