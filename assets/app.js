import { I18N } from './i18n.js';
import { initViewer, swapProduct, PRODUCTS } from './scene3d.js';

const LANG_META = {
  it: { flag: '🇮🇹', label: 'Italiano', code: 'IT' },
  en: { flag: '🇬🇧', label: 'English',  code: 'EN' },
  zh: { flag: '🇨🇳', label: '中文',      code: 'ZH' }
};

const STORAGE_KEY = 'sumaLang';

function applyTranslations(lang) {
  const dict = I18N[lang] || I18N.it;
  document.documentElement.lang = lang;

  document.querySelectorAll('[data-i18n]').forEach(el => {
    const key = el.getAttribute('data-i18n');
    if (dict[key] != null) el.textContent = dict[key];
  });

  document.querySelectorAll('[data-i18n-attr]').forEach(el => {
    el.getAttribute('data-i18n-attr').split(',').forEach(pair => {
      const [attr, key] = pair.split(':').map(s => s.trim());
      if (attr && key && dict[key] != null) el.setAttribute(attr, dict[key]);
    });
  });

  // language button label
  const meta = LANG_META[lang];
  const btn = document.querySelector('#langBtn .lang-code');
  if (btn && meta) btn.textContent = meta.code;

  // active option in dropdown
  document.querySelectorAll('.lang-menu button').forEach(b => {
    b.classList.toggle('active', b.dataset.lang === lang);
  });

  // refresh 3D dimensions panel (uses translated labels)
  updateDimsPanel(lang);
}

function setLang(lang) {
  if (!I18N[lang]) lang = 'it';
  localStorage.setItem(STORAGE_KEY, lang);
  applyTranslations(lang);
}

function initLangSwitcher() {
  const wrap = document.querySelector('.lang');
  const btn = document.querySelector('#langBtn');
  if (!wrap || !btn) return;

  btn.addEventListener('click', e => {
    e.stopPropagation();
    wrap.classList.toggle('open');
  });
  document.addEventListener('click', () => wrap.classList.remove('open'));

  document.querySelectorAll('.lang-menu button').forEach(b => {
    b.addEventListener('click', () => {
      setLang(b.dataset.lang);
      wrap.classList.remove('open');
    });
  });
}

function initMobileNav() {
  const nav = document.querySelector('.nav');
  const burger = document.querySelector('.nav-burger');
  if (!burger) return;
  burger.addEventListener('click', () => nav.classList.toggle('mobile-open'));
  document.querySelectorAll('.nav-links a').forEach(a =>
    a.addEventListener('click', () => nav.classList.remove('mobile-open'))
  );
}

function initReveal() {
  const io = new IntersectionObserver((entries) => {
    for (const e of entries) {
      if (e.isIntersecting) {
        e.target.classList.add('visible');
        io.unobserve(e.target);
      }
    }
  }, { threshold: 0.12 });
  document.querySelectorAll('.reveal').forEach(el => io.observe(el));
}

let currentProductKind = 'beam';
function initProducts() {
  const viewerEl = document.getElementById('viewer');
  if (!viewerEl) return;
  initViewer(viewerEl);

  document.querySelectorAll('.product-btn').forEach(b => {
    b.addEventListener('click', () => {
      const kind = b.dataset.product;
      currentProductKind = kind;
      document.querySelectorAll('.product-btn').forEach(x => x.classList.toggle('active', x === b));
      swapProduct(kind);
      updateDimsPanel();
    });
  });
}

function updateDimsPanel(lang) {
  lang = lang || localStorage.getItem(STORAGE_KEY) || 'it';
  const dict = I18N[lang] || I18N.it;
  const dims = PRODUCTS[currentProductKind];
  const el = document.getElementById('dimsPanel');
  if (!el || !dims) return;
  el.innerHTML = `
    <div class="row"><span>${dict['products.length']}</span><b>${dims.L} cm</b></div>
    <div class="row"><span>${dict['products.width']}</span><b>${dims.W} cm</b></div>
    <div class="row"><span>${dict['products.height']}</span><b>${dims.H} cm</b></div>
  `;
}

// boot
document.addEventListener('DOMContentLoaded', () => {
  initLangSwitcher();
  initMobileNav();
  initReveal();
  initProducts();
  const saved = localStorage.getItem(STORAGE_KEY) || 'it';
  setLang(saved);
});
