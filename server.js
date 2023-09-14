const express = require('express');
const morgan = require('morgan');

const app = express();
app.use(morgan('common'));
app.use(express.json());
app.get('/', (req, res) => {
    res.send('hello');
});
app.use('/cats', require('./routes/cats.js'));

app.listen(4000, () => {
    console.log('Server started');
});
