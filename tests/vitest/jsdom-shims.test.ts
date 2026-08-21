// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'

const MODULE = '../../tooling/vitest/jsdom-shims.mjs'

const originals = {
	ResizeObserver: globalThis.ResizeObserver,
	IntersectionObserver: globalThis.IntersectionObserver,
	matchMedia: typeof window !== 'undefined' ? window.matchMedia : undefined,
	hasPointerCapture: Element.prototype.hasPointerCapture,
	setPointerCapture: Element.prototype.setPointerCapture,
	releasePointerCapture: Element.prototype.releasePointerCapture,
	scrollIntoView: Element.prototype.scrollIntoView,
}

afterEach(() => {
	vi.resetModules()
	if (originals.ResizeObserver) globalThis.ResizeObserver = originals.ResizeObserver
	else Reflect.deleteProperty(globalThis as unknown as Record<string, unknown>, 'ResizeObserver')
	if (originals.IntersectionObserver)
		globalThis.IntersectionObserver = originals.IntersectionObserver
	else
		Reflect.deleteProperty(globalThis as unknown as Record<string, unknown>, 'IntersectionObserver')
	if (originals.matchMedia) window.matchMedia = originals.matchMedia
	else Reflect.deleteProperty(window as unknown as Record<string, unknown>, 'matchMedia')
	if (originals.hasPointerCapture) Element.prototype.hasPointerCapture = originals.hasPointerCapture
	else
		Reflect.deleteProperty(
			Element.prototype as unknown as Record<string, unknown>,
			'hasPointerCapture'
		)
	if (originals.setPointerCapture) Element.prototype.setPointerCapture = originals.setPointerCapture
	else
		Reflect.deleteProperty(
			Element.prototype as unknown as Record<string, unknown>,
			'setPointerCapture'
		)
	if (originals.releasePointerCapture)
		Element.prototype.releasePointerCapture = originals.releasePointerCapture
	else
		Reflect.deleteProperty(
			Element.prototype as unknown as Record<string, unknown>,
			'releasePointerCapture'
		)
	if (originals.scrollIntoView) Element.prototype.scrollIntoView = originals.scrollIntoView
	else
		Reflect.deleteProperty(
			Element.prototype as unknown as Record<string, unknown>,
			'scrollIntoView'
		)
})

describe('jsdom-shims', () => {
	it('installs ResizeObserver / IntersectionObserver / matchMedia + pointer-capture polyfills', async () => {
		// Clear what jsdom gave us so we can verify the shim fills the gap.
		Reflect.deleteProperty(globalThis as unknown as Record<string, unknown>, 'ResizeObserver')
		Reflect.deleteProperty(globalThis as unknown as Record<string, unknown>, 'IntersectionObserver')
		Reflect.deleteProperty(window as unknown as Record<string, unknown>, 'matchMedia')
		Reflect.deleteProperty(
			Element.prototype as unknown as Record<string, unknown>,
			'hasPointerCapture'
		)
		Reflect.deleteProperty(
			Element.prototype as unknown as Record<string, unknown>,
			'scrollIntoView'
		)

		vi.resetModules()
		await import(MODULE)

		expect(typeof globalThis.ResizeObserver).toBe('function')
		expect(typeof globalThis.IntersectionObserver).toBe('function')
		expect(typeof window.matchMedia).toBe('function')
		expect(typeof Element.prototype.hasPointerCapture).toBe('function')
		expect(typeof Element.prototype.setPointerCapture).toBe('function')
		expect(typeof Element.prototype.releasePointerCapture).toBe('function')
		expect(typeof Element.prototype.scrollIntoView).toBe('function')

		const ro = new globalThis.ResizeObserver(() => {})
		expect(() => ro.observe(document.body)).not.toThrow()
		expect(() => ro.disconnect()).not.toThrow()

		const mql = window.matchMedia('(min-width: 768px)')
		expect(mql.matches).toBe(false)
		expect(mql.media).toBe('(min-width: 768px)')
		expect(typeof mql.addEventListener).toBe('function')

		expect(document.body.hasPointerCapture(1)).toBe(false)
	})

	it('does not overwrite already-installed implementations', async () => {
		const sentinel = class {
			observe() {}
			unobserve() {}
			disconnect() {}
		}
		Reflect.deleteProperty(globalThis as unknown as Record<string, unknown>, 'ResizeObserver')
		// @ts-expect-error — install the sentinel first
		globalThis.ResizeObserver = sentinel

		vi.resetModules()
		await import(MODULE)

		expect(globalThis.ResizeObserver).toBe(sentinel)
	})
})
