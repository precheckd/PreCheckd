const mongoose = require('mongoose');

const messageSchema = new mongoose.Schema({
  connectionRequestId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'ConnectionRequest',
    required: true
  },

  senderType: {
    type: String,
    enum: ['recruiter', 'candidate'],
    required: true
  },
  senderId: {
    type: mongoose.Schema.Types.ObjectId,
    required: true
  },

  recipientType: {
    type: String,
    enum: ['recruiter', 'candidate'],
    required: true
  },
  recipientId: {
    type: mongoose.Schema.Types.ObjectId,
    required: true
  },

  subject: {
    type: String,
    default: null
  },
  body: {
    type: String,
    required: true
  },

  sentAt: {
    type: Date,
    default: Date.now
  },
  readAt: {
    type: Date,
    default: null
  }
});

module.exports = mongoose.model('Message', messageSchema);