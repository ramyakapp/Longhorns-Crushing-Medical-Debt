import type { GetHydrateCallback, HydrateOptions } from '../../@types/astro';

/**
 * Hydrate this component as soon as the main thread is free
 * (or after a short delay, if `requestIdleCallback`) isn't supported
 */
export default async function onIdle(astroId: string, options: HydrateOptions, getHydrateCallback: GetHydrateCallback) {
	async function idle() {
		const cb = async () => {
			const roots = document.querySelectorAll(`astro-root[ssr][uid="${astroId}"]`);
			if (roots.length === 0) return;

			let innerHTML: string | null = null;
			let fragment = roots[0].querySelector(`astro-fragment`);
			if (fragment == null && roots[0].hasAttribute('tmpl')) {
				// If there is no child fragment, check to see if there is a template.
				// This happens if children were passed but the client component did not render any.
				let template = roots[0].querySelector(`template[data-astro-template]`);
				if (template) {
					innerHTML = template.innerHTML;
					template.remove();
				}
			} else if (fragment) {
				innerHTML = fragment.innerHTML;
			}
			const hydrate = await getHydrateCallback();

			for (const root of roots) {
				hydrate(root, innerHTML);
				root.removeAttribute('ssr');
			}
		};

		if ('requestIdleCallback' in window) {
			(window as any).requestIdleCallback(cb);
		} else {
			setTimeout(cb, 200);
		}
		window.addEventListener('astro:locationchange', idle, { once: true })
	}
	idle();
}
