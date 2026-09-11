import type { AppState } from './domain';

/** All readable exports traverse the author's approved chapter order. */
export function bookMarkdown(state: AppState) {
  const chapters = state.book.chapterIds.map(id => state.chapters.find(chapter => chapter.id === id)).filter(chapter => !!chapter);
  return [`# ${state.book.title}`, ...chapters.flatMap(chapter => [`\n## ${chapter.title}\n`, ...chapter.storyIds.flatMap(id => {
    const story = state.stories.find(item => item.id === id);
    return story ? [`\n### ${story.title}\n`, story.text] : [];
  })])].join('\n');
}
