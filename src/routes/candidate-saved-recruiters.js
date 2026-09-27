const express = require('express');
const router = express.Router();

function requireCandidateLogin(req, res, next) {
  if (!req.session.candidateId) {
    return res.redirect('/candidate-signup');
  }
  next();
}

router.use(requireCandidateLogin);

// GET /candidate-dashboard/saved-recruiters — the "My Saved Recruiters" page
router.get('/saved-recruiters', (req, res) => {
  res.render('saved-recruiters');
});

module.exports = router;