import { sveltekit } from '@sveltejs/kit/vite';
import tailwindcss from '@tailwindcss/vite';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

/**
 * Test projects do not load the SvelteKit plugin, so they need the `$lib`
 * alias declared explicitly -- otherwise modules that import through it
 * (schemas, server helpers) cannot be unit tested.
 */
const alias = {
	$lib: fileURLToPath(new URL('./src/lib', import.meta.url))
};

export default defineConfig({
	plugins: [tailwindcss(), sveltekit()],
	test: {
		projects: [
			{
				resolve: { alias },
				test: {
					name: 'domain',
					include: ['tests/domain/**/*.test.ts'],
					environment: 'node'
				}
			},
			{
				resolve: { alias },
				test: {
					name: 'db',
					include: ['tests/db/**/*.test.ts'],
					environment: 'node',
					testTimeout: 120_000,
					hookTimeout: 120_000,
					// Each file boots its own Postgres; running them serially
					// keeps peak memory sane.
					pool: 'forks',
					fileParallelism: false
				}
			}
		]
	}
});
