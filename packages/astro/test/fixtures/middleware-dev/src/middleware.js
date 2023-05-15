import { sequence, defineMiddleware } from 'astro/middleware';

const first = defineMiddleware(async (context, next) => {
	if (context.request.url.includes('/lorem')) {
		context.locals.name = 'ipsum';
	} else if (context.request.url.includes('/rewrite')) {
		return new Response('<span>New content!!</span>', {
			status: 200,
		});
	} else if (context.request.url.includes('/broken-500')) {
		return new Response(null, {
			status: 500,
		});
	} else {
		context.locals.name = 'bar';
	}
	return await next();
});

const second = defineMiddleware(async (context, next) => {
	if (context.request.url.includes('/second')) {
		context.locals.name = 'second';
	} else if (context.request.url.includes('/redirect')) {
		return context.redirect('/', 302);
	}
	return await next();
});

const third = defineMiddleware(async (context, next) => {
	if (context.request.url.includes('/broken-locals')) {
		context.locals = {
			fn() {},
		};
	} else if (context.request.url.includes('/does-nothing')) {
		return undefined;
	}
	return next();
});

export const onRequest = sequence(first, second, third);
