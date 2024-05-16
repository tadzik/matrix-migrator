import React from 'react';

import SourceAccount from './SourceAccount';
import TargetAccount from './TargetAccount';

function App() {
  return (
    <>
      <header>
        <h1> Matrix Migrator </h1>
      </header>
      <main>
        <SourceAccount />
        <TargetAccount />
      </main>
    </>
  );
}

export default App;
