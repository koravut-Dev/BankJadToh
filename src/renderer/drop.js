const th = (navigator.language || '').toLowerCase().startsWith('th');
    const L = th
      ? { a: 'วางไฟล์ที่นี่', b: 'แบงค์ จัดโต๊ะจะจัดเข้าโฟลเดอร์ที่เหมาะสมให้', ok: (n, l) => `จัดแล้ว ${n} ไฟล์` + (l ? ` · ข้าม ${l}` : ''), err: 'เกิดข้อผิดพลาด' }
      : { a: 'Drop files here', b: 'Bank JadToh files them in the right folder', ok: (n, l) => `Filed ${n}` + (l ? ` · skipped ${l}` : ''), err: 'Something went wrong' };
    const $ = (id) => document.getElementById(id);
    $('t1').textContent = L.a; $('t2').textContent = L.b;
    $('x').onclick = () => window.close();
    const pad = $('pad');
    pad.addEventListener('dragover', (e) => { e.preventDefault(); pad.classList.add('over'); });
    pad.addEventListener('dragleave', () => pad.classList.remove('over'));
    pad.addEventListener('drop', async (e) => {
      e.preventDefault(); pad.classList.remove('over');
      const paths = [...e.dataTransfer.files].map((f) => window.api.pathFor(f)).filter(Boolean);
      if (!paths.length) return;
      const r = await window.api.invoke('drop:files', paths);
      $('t1').textContent = r.error ? L.err : L.ok(r.moved, r.left);
      $('t2').textContent = r.error ? r.error : r.root;
      setTimeout(() => { $('t1').textContent = L.a; $('t2').textContent = L.b; }, 4000);
    });
