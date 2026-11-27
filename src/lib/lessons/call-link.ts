export function callLinkOf(...links: (string | null | undefined)[]): string | null {
  for (const link of links) {
    if (!link || !/^https?:\/\/[^\s\\]+$/i.test(link)) continue;
    try {
      const url = new URL(link);
      if (url.hostname && !url.username && !url.password) return link;
    } catch {
      // Повреждённая ссылка не мешает использовать следующий доступный вариант.
    }
  }
  return null;
}
