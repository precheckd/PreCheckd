// Shared in-browser video recorder widget.
//
// Each mount point is a <div class="video-recorder" data-upload-url="...">
// (optionally with data-existing-url="https://..." if a video was already
// saved). This script builds the record/stop/preview/re-record/upload UI
// inside it and POSTs the finished recording to data-upload-url as
// multipart/form-data under the field name "video" on upload.
//
// Fires a CustomEvent('video-recorder:uploaded', { detail: { url } }) on the
// mount element when an upload succeeds, so a page can update other UI
// (e.g. swap in the new <video> player) without this file knowing about it.

(function () {
  function createEl(tag, props) {
    var el = document.createElement(tag);
    if (props) Object.keys(props).forEach(function (k) { el[k] = props[k]; });
    return el;
  }

  function initRecorder(root) {
    var uploadUrl = root.getAttribute('data-upload-url');
    var existingUrl = root.getAttribute('data-existing-url') || '';

    var wrap = createEl('div', { className: 'vr-widget' });

    var video = createEl('video', { className: 'vr-video' });
    video.setAttribute('playsinline', '');

    var status = createEl('div', { className: 'vr-status' });

    var btnRecord = createEl('button', { type: 'button', className: 'vr-btn vr-btn-record', textContent: existingUrl ? 'Re-record' : 'Start Recording' });
    var btnStop = createEl('button', { type: 'button', className: 'vr-btn vr-btn-stop', textContent: 'Stop' });
    var btnRerecord = createEl('button', { type: 'button', className: 'vr-btn vr-btn-rerecord', textContent: 'Re-record' });
    var btnUpload = createEl('button', { type: 'button', className: 'vr-btn vr-btn-upload', textContent: 'Save Video' });
    btnStop.style.display = 'none';
    btnRerecord.style.display = 'none';
    btnUpload.style.display = 'none';

    var controls = createEl('div', { className: 'vr-controls' });
    controls.appendChild(btnRecord);
    controls.appendChild(btnStop);
    controls.appendChild(btnRerecord);
    controls.appendChild(btnUpload);

    wrap.appendChild(video);
    wrap.appendChild(status);
    wrap.appendChild(controls);
    root.appendChild(wrap);

    var stream = null;
    var mediaRecorder = null;
    var chunks = [];
    var recordedBlob = null;
    var mimeType = 'video/webm';

    if (existingUrl) {
      video.src = existingUrl;
      video.controls = true;
      status.textContent = 'Saved recording. Record a new one to replace it.';
    } else {
      video.muted = true;
    }

    function setStatus(text) {
      status.textContent = text;
    }

    function pickMimeType() {
      var candidates = ['video/webm;codecs=vp8,opus', 'video/webm', 'video/mp4'];
      for (var i = 0; i < candidates.length; i++) {
        if (window.MediaRecorder && MediaRecorder.isTypeSupported && MediaRecorder.isTypeSupported(candidates[i])) {
          return candidates[i];
        }
      }
      return 'video/webm';
    }

    async function startRecording() {
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        setStatus('Your browser does not support camera recording.');
        return;
      }
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
      } catch (err) {
        setStatus('Could not access your camera/microphone. Please check permissions and try again.');
        return;
      }

      video.srcObject = stream;
      video.muted = true;
      video.controls = false;
      video.play();

      mimeType = pickMimeType();
      chunks = [];
      try {
        mediaRecorder = new MediaRecorder(stream, { mimeType: mimeType });
      } catch (err) {
        mediaRecorder = new MediaRecorder(stream);
      }

      mediaRecorder.ondataavailable = function (e) {
        if (e.data && e.data.size > 0) chunks.push(e.data);
      };

      mediaRecorder.onstop = function () {
        recordedBlob = new Blob(chunks, { type: mimeType });
        stream.getTracks().forEach(function (track) { track.stop(); });
        video.srcObject = null;
        video.src = URL.createObjectURL(recordedBlob);
        video.muted = false;
        video.controls = true;
        video.play();

        btnStop.style.display = 'none';
        btnRerecord.style.display = '';
        btnUpload.style.display = '';
        setStatus('Preview your recording, then save it, or re-record.');
      };

      mediaRecorder.start();
      btnRecord.style.display = 'none';
      btnStop.style.display = '';
      setStatus('Recording...');
    }

    function stopRecording() {
      if (mediaRecorder && mediaRecorder.state !== 'inactive') {
        mediaRecorder.stop();
      }
    }

    function reset() {
      recordedBlob = null;
      video.removeAttribute('src');
      video.load();
      btnRecord.style.display = '';
      btnRecord.textContent = 'Start Recording';
      btnStop.style.display = 'none';
      btnRerecord.style.display = 'none';
      btnUpload.style.display = 'none';
      setStatus('');
    }

    async function upload() {
      if (!recordedBlob) return;
      btnUpload.disabled = true;
      btnUpload.textContent = 'Saving...';
      setStatus('Uploading your video...');

      try {
        var extension = mimeType.indexOf('mp4') !== -1 ? 'mp4' : 'webm';
        var formData = new FormData();
        formData.append('video', recordedBlob, 'recording.' + extension);

        var response = await fetch(uploadUrl, { method: 'POST', body: formData });
        var data = await response.json().catch(function () { return {}; });

        if (!response.ok) {
          setStatus(data.error || 'Something went wrong saving your video. Please try again.');
          btnUpload.disabled = false;
          btnUpload.textContent = 'Save Video';
          return;
        }

        setStatus('Saved!');
        btnUpload.style.display = 'none';
        btnRerecord.textContent = 'Record Again';
        root.setAttribute('data-existing-url', data.url || '');
        root.dispatchEvent(new CustomEvent('video-recorder:uploaded', { detail: { url: data.url }, bubbles: true }));
      } catch (err) {
        setStatus('Could not reach the server. Please try again.');
        btnUpload.disabled = false;
        btnUpload.textContent = 'Save Video';
      }
    }

    btnRecord.addEventListener('click', startRecording);
    btnStop.addEventListener('click', stopRecording);
    btnRerecord.addEventListener('click', function () {
      reset();
      startRecording();
    });
    btnUpload.addEventListener('click', upload);
  }

  document.querySelectorAll('.video-recorder').forEach(initRecorder);
})();
