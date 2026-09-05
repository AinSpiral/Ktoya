'use client';

import { useLayoutEffect, useRef, useState } from 'react';
import { ForestBackdrop } from './forest-scene';
import { LifeBookArtwork } from './life-book-artwork';

const ROOT = '/art/living-world-v2/';
const desktop = (format: string) => `${ROOT}hero-desktop-1200.${format} 1200w, ${ROOT}hero-desktop-1584.${format} 1584w`;
const mobile = (format: string) => `${ROOT}hero-mobile-768.${format} 768w, ${ROOT}hero-mobile-1024.${format} 1024w`;
const roots = (format: string) => `${ROOT}tree-ring-clock-640.${format} 640w, ${ROOT}tree-ring-clock-1200.${format} 1200w`;

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
  const zone = useRef<HTMLDivElement>(null);
  const [coverTransform, setCoverTransform] = useState<string>();
  useLayoutEffect(() => {
    const element = zone.current;
    const image = element?.closest('.forest-masthead')?.querySelector<HTMLImageElement>('.living-world-forest img');
    if (!element || !image) return;
    const align = () => {
      const frame = image.getBoundingClientRect();
      const origin = element.getBoundingClientRect();
      const portrait = window.matchMedia('(max-width: 900px)').matches;
      const width = portrait ? 1024 : 1586;
      const height = portrait ? 1536 : 992;
      const scale = Math.max(frame.width / width, frame.height / height);
      const offsetX = frame.left - origin.left + (frame.width - width * scale) / 2;
      const offsetY = frame.top - origin.top + (frame.height - height * scale) / 2;
      // Measured front-board corners of the approved masters: TL, TR, BR, BL.
      const corners = portrait ? [[407,532],[743,538],[635,1205],[295,1140]] : [[936,194],[1354,170],[1280,800],[845,766]];
      const [p0,p1,p2,p3] = corners.map(([x,y]) => [offsetX + x * scale,offsetY + y * scale]);
      const dx1=p1[0]-p2[0],dx2=p3[0]-p2[0],dx3=p0[0]-p1[0]+p2[0]-p3[0];
      const dy1=p1[1]-p2[1],dy2=p3[1]-p2[1],dy3=p0[1]-p1[1]+p2[1]-p3[1];
      const divisor=dx1*dy2-dx2*dy1;
      if (!Number.isFinite(divisor) || Math.abs(divisor)<.001) return;
      const g=(dx3*dy2-dx2*dy3)/divisor,h=(dx1*dy3-dx3*dy1)/divisor;
      const a=p1[0]-p0[0]+g*p1[0],b=p3[0]-p0[0]+h*p3[0];
      const d=p1[1]-p0[1]+g*p1[1],e=p3[1]-p0[1]+h*p3[1];
      setCoverTransform(`matrix3d(${a/400},${d/400},0,${g/400},${b/600},${e/600},0,${h/600},0,0,1,0,${p0[0]},${p0[1]},0,1)`);
    };
    const observer = new ResizeObserver(align);
    observer.observe(element);
    observer.observe(image);
    image.addEventListener('load',align);
    align();
    return () => { observer.disconnect(); image.removeEventListener('load',align); };
  },[]);
  return <div className="living-book-zone" ref={zone} aria-hidden="true">
    <div className="living-procedural-fallback"><LifeBookArtwork /></div>
    <article className="living-cover-plane" style={{ transform: coverTransform }}>
      <span className="living-cover-brand">КтоЯ</span>
      <p><span>Не идеальная биография.</span><span>Живая и настоящая жизнь.</span></p>
    </article>
  </div>;
}

export function LivingAncestryImage() {
  return <figure className="living-ancestry-figure living-time-figure">
    <picture>
      <source type="image/avif" srcSet={roots('avif')} sizes="(max-width: 760px) calc(100vw - 40px), 47vw" />
      <img src={`${ROOT}tree-ring-clock-640.webp`} srcSet={roots('webp')} sizes="(max-width: 760px) calc(100vw - 40px), 47vw" width="1536" height="1024" loading="lazy" alt="Спил ветви живого дерева: годичные кольца и три естественные трещины напоминают течение времени" />
    </picture>
    <figcaption><span>Дерево хранит время в кольцах.</span> Ты — в историях.</figcaption>
  </figure>;
}
