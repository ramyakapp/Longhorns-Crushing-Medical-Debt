import type {
	APIContext,
	AstroConfig,
	AstroMiddlewareInstance,
	EndpointHandler,
	EndpointOutput,
	MiddlewareEndpointHandler,
	Params,
} from '../../@types/astro';
import type { Environment, RenderContext } from '../render/index';

import { renderEndpoint } from '../../runtime/server/index.js';
import { ASTRO_VERSION } from '../constants.js';
import { AstroCookies, attachToResponse } from '../cookies/index.js';
import { AstroError, AstroErrorData } from '../errors/index.js';
import { warn, type LogOptions } from '../logger/core.js';
import { callMiddleware } from '../middleware/callMiddleware.js';
import { isValueSerializable } from '../render/core.js';

const clientAddressSymbol = Symbol.for('astro.clientAddress');
const clientLocalsSymbol = Symbol.for('astro.locals');

type EndpointCallResult =
	| {
			type: 'simple';
			body: string;
			encoding?: BufferEncoding;
			cookies: AstroCookies;
	  }
	| {
			type: 'response';
			response: Response;
	  };

export function createAPIContext({
	request,
	params,
	site,
	props,
	adapterName,
}: {
	request: Request;
	params: Params;
	site?: string;
	props: Record<string, any>;
	adapterName?: string;
}): APIContext {
	const context = {
		cookies: new AstroCookies(request),
		request,
		params,
		site: site ? new URL(site) : undefined,
		generator: `Astro v${ASTRO_VERSION}`,
		props,
		redirect(path, status) {
			return new Response(null, {
				status: status || 302,
				headers: {
					Location: path,
				},
			});
		},
		url: new URL(request.url),
		get clientAddress() {
			if (!(clientAddressSymbol in request)) {
				if (adapterName) {
					throw new AstroError({
						...AstroErrorData.ClientAddressNotAvailable,
						message: AstroErrorData.ClientAddressNotAvailable.message(adapterName),
					});
				} else {
					throw new AstroError(AstroErrorData.StaticClientAddressNotAvailable);
				}
			}

			return Reflect.get(request, clientAddressSymbol);
		},
	} as APIContext;

	// We define a custom property, so we can check the value passed to locals
	Object.defineProperty(context, 'locals', {
		get() {
			return Reflect.get(request, clientLocalsSymbol);
		},
		set(val) {
			if (typeof val !== 'object') {
				throw new AstroError(AstroErrorData.LocalsNotAnObject);
			} else {
				Reflect.set(request, clientLocalsSymbol, val);
			}
		},
	});
	return context;
}

export async function call<MiddlewareResult = Response | EndpointOutput>(
	mod: EndpointHandler,
	env: Environment,
	ctx: RenderContext,
	logging: LogOptions,
	middleware?: AstroMiddlewareInstance<MiddlewareResult> | undefined
): Promise<EndpointCallResult> {
	const context = createAPIContext({
		request: ctx.request,
		params: ctx.params,
		props: ctx.props,
		site: env.site,
		adapterName: env.adapterName,
	});

	let response = await renderEndpoint(mod, context, env.ssr);
	if (middleware && middleware.onRequest) {
		if (response.body === null) {
			const onRequest = middleware.onRequest as MiddlewareEndpointHandler;
			response = await callMiddleware<Response | EndpointOutput>(onRequest, context, async () => {
				if (env.mode === 'development' && !isValueSerializable(context.locals)) {
					throw new AstroError({
						...AstroErrorData.LocalsNotSerializable,
						message: AstroErrorData.LocalsNotSerializable.message(ctx.pathname),
					});
				}
				return response;
			});
		} else {
			warn(
				env.logging,
				'middleware',
				"Middleware doesn't work for endpoints that return a simple body. The middleware will be disabled for this page."
			);
		}
	}

	if (response instanceof Response) {
		attachToResponse(response, context.cookies);
		return {
			type: 'response',
			response,
		};
	}

	if (env.ssr && !mod.prerender) {
		if (response.hasOwnProperty('headers')) {
			warn(
				logging,
				'ssr',
				'Setting headers is not supported when returning an object. Please return an instance of Response. See https://docs.astro.build/en/core-concepts/endpoints/#server-endpoints-api-routes for more information.'
			);
		}

		if (response.encoding) {
			warn(
				logging,
				'ssr',
				'`encoding` is ignored in SSR. To return a charset other than UTF-8, please return an instance of Response. See https://docs.astro.build/en/core-concepts/endpoints/#server-endpoints-api-routes for more information.'
			);
		}
	}

	return {
		type: 'simple',
		body: response.body,
		encoding: response.encoding,
		cookies: context.cookies,
	};
}

function isRedirect(statusCode: number) {
	return statusCode >= 300 && statusCode < 400;
}

export function throwIfRedirectNotAllowed(response: Response, config: AstroConfig) {
	if (config.output !== 'server' && isRedirect(response.status)) {
		throw new AstroError(AstroErrorData.StaticRedirectNotAvailable);
	}
}
