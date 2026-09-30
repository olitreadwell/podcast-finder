import Link from 'next/link';

/**
 * Custom 404 page: explains the miss and points back to the homepage.
 *
 * @returns The not-found page
 */
export default function NotFound() {
  return (
    <main
      id="main-content"
      className="mx-auto flex min-h-[60vh] max-w-2xl flex-col items-center justify-center gap-4 px-6 text-center scroll-mt-20"
    >
      <h1 className="text-3xl font-semibold">Page not found</h1>
      <p className="text-neutral-600 dark:text-neutral-400">
        The page you are looking for does not exist or has moved.
      </p>
      <Link className="text-blue-600 underline dark:text-blue-400" href="/">
        Back to the homepage
      </Link>
    </main>
  );
}
