import request from './request';

// 分页查询摄像头
export function getCameras(params) {
  return request.get('/camera', { params });
}

// 新增摄像头
export function createCamera(data) {
  return request.post('/camera', data);
}

// 修改摄像头
export function updateCamera(id, data) {
  return request.put(`/camera/${id}`, data);
}

// 删除摄像头
export function deleteCamera(id) {
  return request.delete(`/camera/${id}`);
}

// 链接摄像头生成视频(设置视频流地址)
export function linkVideo(id, videoUrl) {
  return request.post('/camera/link', { id, videoUrl });
}

// 上传大视频生成离线摄像头
export function uploadVideo(formData, onProgress) {
  return request.post('/camera/upload', formData, {
    headers: { 'Content-Type': 'multipart/form-data' },
    onUploadProgress: (e) => {
      if (onProgress && e.total) onProgress(Math.round((e.loaded / e.total) * 100));
    },
  });
}
