
const gulp = require('gulp')
const createServer = require('./index.js').createServer
const createSocket = require('./index.js').createSocket
const getPort = require('get-port')
const fs = require('fs')
var Q = require('q')

gulp.task('test', (cb) => {
		console.log('Testing uTP');

		server = createServer()
		sock = createSocket()
		
		/*server.cheat.on('finish', () => {
				console.log("closing")
				//sock.close()
				//sock.on('closed', cb)
				cb()
		})*/
		//sock.on('finish', cb)
		
		getPort().then(port => {
			console.log('Server: listening on port', port)
			
			//server.on('connection', (server_sock)=> {server_sock.pipe(process.stdout)})
			server.listen(port)
					
			sock.connect(port)
			f = fs.createReadStream('../../number.txt')
			sock.on('connected', f.pipe(sock))
			
		});
		setTimeout(cb, 2000)
		//return f
		
});