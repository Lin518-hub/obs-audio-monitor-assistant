import React from 'react';

/** Full-screen visual emphasis behind the normal alert dialog. */
export const AlertBackdropApp: React.FC = () => (
  <main className="alert-backdrop-shell" aria-hidden="true">
    <div className="alert-backdrop-vignette" />
  </main>
);
