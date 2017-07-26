
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
		
		getPort().then(port => {
			console.log('Server: listening on port', port)
			
			//server.on('connection', (server_sock)=> {server_sock.pipe(process.stdout)})
			server.listen(port)
					
			sock.connect(port)
			
			sock.on('connected', fs.createReadStream('./c_primer_5th_edition.pdf').pipe(sock))
			
		});
		
		
		//return deferred.promise;
		
		setTimeout(()=>{
			//console.log(sock.dataBuffer.length)
			//console.log(sock.dataBuffer)
			//console.log(sock.sendBuffer)
			//console.log(sock)
			//console.log('THIS TIME ENDING5')
			//sock.end()
			//console.log(server.cheat[0].recvBuffer)
			cb()
		}, 50000)
});