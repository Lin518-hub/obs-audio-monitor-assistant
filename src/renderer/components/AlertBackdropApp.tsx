import React from 'react';

/** Full-screen visual emphasis behind the normal alert dialog. */
export const AlertBackdropApp: React.FC = () => (
  <main className="alert-backdrop-shell" aria-hidden="true">
    <span className="alert-backdrop-edge top" />
    <span className="alert-backdrop-edge right" />
    <span className="alert-backdrop-edge bottom" />
    <span className="alert-backdrop-edge left" />
    <span className="alert-backdrop-outline" />
  </main>
);
