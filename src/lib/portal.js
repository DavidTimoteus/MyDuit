import { createPortal } from 'react-dom'

/**
 * Merender modal atau overlay ke `document.body` agar tidak pernah terkurung
 * overflow atau stacking context ancestor, sekaligus aman saat SSR di Node.
 */
export function portalBody(node) {
  if (!node) return null
  return typeof document !== 'undefined' && document.body
    ? createPortal(node, document.body)
    : node
}
