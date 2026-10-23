import { createCn } from "cn/config";

/**
 * Class merging aware of the PULSE type scale (globals.css `--text-*`): without this, `text-meta` would be
 * read as a colour and silently dropped next to `text-ink-muted`.
 */
export const cn = createCn({
  extend: { classGroups: { "font-size": [{ text: ["display", "title", "headline", "body", "small", "meta", "eyebrow"] }] } },
});
