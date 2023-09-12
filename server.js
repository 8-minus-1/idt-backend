const express = require('express');
const morgan = require('morgan');
const bodyParser = require('body-parser');

const app = express();
app.use(morgan('common'));
app.use(bodyParser.json());
app.get('/', (req, res) => {
    res.send('hello');
});
app.use('/cats', require('./routes/cats.js'));

app.listen(4000, () => {
    console.log('Server started');
});
