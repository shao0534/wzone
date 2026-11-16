// 路由聚合入口
const router = require('express').Router();

router.use('/auth', require('./auth'));
router.use('/blog', require('./blog'));
router.use('/tool', require('./tool'));
router.use('/camera', require('./camera'));
router.use('/stream', require('./stream'));
router.use('/role', require('./role'));
router.use('/application', require('./application'));
router.use('/notification', require('./notification'));

module.exports = router;
