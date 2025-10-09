export const chunkMessage = (content: string, limit = 1900): string[] => {
  if (!content) return [""];
  const lines = content.split(/\n/);
  const chunks: string[] = [];
  let buf: string[] = [];
  let len = 0;
  const pushBuf = () => {
    if (buf.length > 0) {
      chunks.push(buf.join('\n'));
      buf = [];
      len = 0;
    }
  };
  for (const line of lines) {
    // 大きすぎる 1 行は強制分割
    if (line.length > limit) {
      pushBuf();
      for (let i = 0; i < line.length; i += limit) {
        chunks.push(line.slice(i, i + limit));
      }
      continue;
    }
    if (len + (len > 0 ? 1 : 0) + line.length > limit) {
      pushBuf();
    }
    buf.push(line);
    len += (len > 0 ? 1 : 0) + line.length;
  }
  pushBuf();
  return chunks.length > 0 ? chunks : [content];
};

