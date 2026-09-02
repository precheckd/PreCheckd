function notFoundHandler(req, res) {
  res.status(404).render('error', { title: 'Not Found', message: 'Page not found' });
}

function errorHandler(err, req, res, next) {
  console.error(err);
  const status = err.status || 500;
  if (req.accepts('html')) {
    return res.status(status).render('error', {
      title: 'Error',
      message: status === 500 ? 'Something went wrong' : err.message,
    });
  }
  res.status(status).json({ error: err.message || 'Internal server error' });
}

module.exports = { notFoundHandler, errorHandler };
