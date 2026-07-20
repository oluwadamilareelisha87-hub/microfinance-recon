const express = require('express');

const app = express();
const PORT = 3000;

// A simple "health check" route — confirms the server is alive and responding
app.get('/', (req, res) => {
  res.json({ message: 'Bowen MFB Reconciliation Engine API is running' });
});

app.listen(PORT, () => {
  console.log(`Server is running on http://localhost:${PORT}`);
});