if ('IntersectionObserver' in window) {
 const observer = new IntersectionObserver(entries => {
  for (const entry of entries) entry.target.classList.toggle('offscreen', !entry.isIntersecting);
 });
 document.querySelectorAll('.forest-decoration, .sky').forEach(element => observer.observe(element));
}
const updateVisibility = () => document.body.classList.toggle('page-hidden', document.hidden);
document.addEventListener('visibilitychange', updateVisibility);
updateVisibility();
