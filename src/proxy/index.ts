import Proxy from './proxy';

Proxy.listen(4444).then((p) => {
  console.log(`Proxy up at localhost:4444.`);
  p.onRequest((f) => {
    console.log(`[${f.mimetype}] ${f.url}`);
    return f;
  });
});