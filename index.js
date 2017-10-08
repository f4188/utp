
Dgram = require('dgram')
Duplex = require('stream').Duplex
Crypto = require('crypto')
Util = require('util')
EventEmitter = require('events').EventEmitter

Heap = require('./lib/heap.js')
SendBuffer = require('./lib/WindowBuffer.js').SendBuffer
RecvWindow = require('./lib/WindowBuffer.js').RecvWindow

speedometer = require('speedometer')
speed = speedometer(4)
speed3 = speedometer(4)
speed2 = speedometer(360)

const VERSION = 1
const ST_DATA = 0 //Data
const ST_FIN = 1
const ST_STATE = 2 //Ack
const ST_RESET = 3  
const ST_SYN  = 4

DEFAULT_WIN_UDP_BUFFER = 8000

INITIAL_PACKET_SIZE = 500
CCONTROL_TARGET = 100000
MAX_CWND_INCREASE_PACKETS_PER_RTT = 0.5 * INITIAL_PACKET_SIZE
DEFAULT_INITIAL_WINDOW_SIZE = 1500 * 2
DEFAULT_RECV_WINDOW_SIZE = 100000 // 100kB
KEEP_ALIVE_INTERVAL = 120000 //millis
MIN_DEFAULT_TIMEOUT = 2000000 //micros

function createServer() {

	return new Server()
	
}

function Server() {

	EventEmitter.call(this)
	this.udpSock;
	this.conSockets = {};
	this.cheat;

}

Util.inherits(Server, EventEmitter)

Server.prototype.listen = function(port, connectListener) { 
	
	this.udpSock = Dgram.createSocket('udp4');
	this.udpSock.bind(port);
	
	this.udpSock.on('message', (msg, rinfo) => {
		var header = getHeaderBuf(msg)
		var id = rinfo.address + ":" + rinfo.port + "#" + ((header.type != ST_SYN) ? header.connection_id : (header.connection_id + 1));
		if(this.conSockets[id]) 
			return this.conSockets[id]._recv(msg);
		
		if(header.type != ST_SYN) 
			return

		this.conSockets[id] = new Socket(this.udpSock, rinfo.port, rinfo.address)
		this.cheat = this.conSockets[id]
		//this.conSockets[id].on('finish', (function() {delete this.conSockets[id]}).bind(this))
		this.conSockets[id].on('error', (function(error) {delete this.conSockets[id]}).bind(this))
		this.conSockets[id].on('close', (function() {delete this.conSockets[id]}).bind(this))

		console.log("New connection | id:", id)
		this.conSockets[id].on('data', (data) => {
			this.conSockets[id].total += data.length; 
			process.stdout.cursorTo(0)
			process.stdout.write("Total: " +  (this.conSockets[id].total / 1000).toPrecision(8) + " KB | DR: " + (speed(data.length)*8 / 1000) + " Kb/s (2 sec avg) | DR: " + (speed2(data.length)*8/1000).toPrecision(5) + " Kb/s (1 min avg) | Reply micro: " + (this.conSockets[id].reply_micro).toPrecision(7) + " | Base Delay: " + (this.conSockets[id].reply_micro - this.conSockets[id].win_reply_micro.peekMinValue()) + "       ");
		})
		this.emit('connection',this.conSockets[id])
		this.conSockets[id]._recv(msg)	
	})

}

Server.prototype.close = function() {
	//this.conSockets.forEach((sock)=>{
		//sock._sendFin()
		//sock.on('finish') delete this.conSockets[i]
	//	sock.close()
	//})
}

function createSocket() {

	return new Socket(Dgram.createSocket('udp4'))

}

function Socket(udpSock, port, host) {

	Duplex.call(this)	
	this.port = port;
	this.host = host;
	this.total = 0

	this.dataBuffer = Buffer.alloc(0)
	this.sendBuffer; //fix names
	this.recvWindow;
	this.packet_size = INITIAL_PACKET_SIZE

	this.ssthresh = DEFAULT_INITIAL_WINDOW_SIZE * 100
	this.slowStart = false
	this.packetsInFlight = 0

	//timers
	this.keepAlive; //syn'er
	//this.alive //if recv data or keepalive message stay connected otherwise kill connection
	this.synTimer;  //syn'er
	//this.recvSynTimer // recv syn'nr
	
	this.udpSock = udpSock;

	this.state = {
		'UNINITIALIZED': 0, //not connected
		'SYN_SENT': 1,	//connecting
		'SYN_RECV': 2, //connecting
		'CONNECTED': 3, //connected
		'FIN_RECV': 4,  //recvFin
		'FIN_SENT' : 5, //end but only after databuffer is empty
		'DISCONNECTED' : 6 //not connected
	}

	this.connected = false;
	this.connecting = false; //send/recv syn
	this.disconnecting = false;
	this.recvFin = false //sendfin
	this.end = false
	this.eof_pkt = null;
	
	this.dupAck = 0;
	this.lastRetransmit; //initialized in sendSyn and recvSyn
	this.lastDupAck = null
	this.ssthresh = this.packet_size

	this.uploadSpeed = 0

	this.sendConnectID; 
	this.recvConnectID; 
	
	this.default_timeout = MIN_DEFAULT_TIMEOUT
	this.rtt = 500*1e3;
	this.rtt_var = 100*1e3;

	this.timeStamp = function () { return (Date.now() * 1e3 )  % Math.pow(2,32) } //not really a microsecond timestamp
	this.win_reply_micro = new Heap()
	this.reply_micro = 0 //zero in spec
	this.timestamp_difference_microseconds = Math.pow(2,31)// 250*1e3 //maybe zero?

	/*
	this.statServer = http.createServer((req,res) => {
		res.write(this.sendBuffer.curWindow())
		res.end()
	})
	this.statServer.listen(3000)*/
	this.file = fs.createWriteStream('./windowsize.log')
	this.file2 = fs.createWriteStream('./timeout_dupack.log')

}

Util.inherits(Socket, Duplex)

Socket.prototype.remoteAddress = function () {

	return {'port' : this.port, 'host' : this.host}

}

Socket.prototype.connect = function (port, host) {

	this.port = port;
	this.host = host;	

	this.inter = setInterval(function() {this.file.write((this.timeStamp()/1e3) + " " + this.sendBuffer.curWindow() + " " + this.sendBuffer.maxWindowBytes + " " + this.sendBuffer.ackNum() + " " + this.rtt +"\n")
}.bind(this), 50)
	this.udpSock.on('message', (msg, rinfo) => {
		if(getHeaderBuf(msg).connection_id == this.recvConnectID) 
			this._recv(msg);
		process.stdout.cursorTo(0)
		process.stdout.write("Max window size " + (this.sendBuffer.maxWindowBytes).toPrecision(7) + " | Current window size: " + (this.sendBuffer.curWindow()).toPrecision(5) + " | Upload: " + this.uploadSpeed * 8 +  " | Reply micro " + ("       " + (this.reply_micro).toPrecision(6)).slice(-8) + " | Base delay: " + (this.reply_micro - this.win_reply_micro.peekMinValue()))	
	})	

	this.connecting = true;
	this._sendSyn()

}

Socket.prototype._sendSyn = function() { //called by connect

	let seq_nr = Crypto.randomBytes(2).readUInt16BE();
	this.recvConnectID = Crypto.randomBytes(2).readUInt16BE();
	this.sendConnectID = this.recvConnectID + 1;
	this.sendBuffer = new SendBuffer(seq_nr, DEFAULT_INITIAL_WINDOW_SIZE, -1, this.packet_size)
	this.lastRetransmit = seq_nr
	let header = this.makeHeader(ST_SYN, seq_nr, null)
	let i = 3, tTime = this.default_timeout
	var syn = (function() {
		this._send(header)
		i--; tTime *= 2
		if(i > 0) this.synTimer = setTimeout(syn, tTime)
		else console.log("Syn timeout")
	}).bind(this) 
	syn()

} 

Socket.prototype._recvSyn = function(header) {

	this.sendConnectID = header.connection_id;
	this.recvConnectID = header.connection_id + 1;
	this.recvWindow = new RecvWindow(header.seq_nr, -1, DEFAULT_RECV_WINDOW_SIZE, this.packet_size)
	let seq_nr = Crypto.randomBytes(2).readUInt16BE()
	this.sendBuffer = new SendBuffer(seq_nr, DEFAULT_INITIAL_WINDOW_SIZE, header.wnd_size, this.packet_size)
	this.lastRetransmit = seq_nr
	this.connecting = true;
	this._sendState(seq_nr, this.recvWindow.ackNum()) //synack

}

Socket.prototype._sendFin = function() {

	this._send(this.makeHeader(ST_FIN, this.sendBuffer.ackNum(), this.recvWindow.ackNum()))

}

Socket.prototype._sendData = function() {

	//if end is true returns with dataBuffer == 0
	while((!this.sendBuffer.isBufferFull() && (this.dataBuffer.length > this.packet_size 
		|| (this.end && this.dataBuffer.length)))
		|| (this.sendBuffer.hasNext() && !this.sendBuffer.isWindowFull())) {

		//this should happen in sendBuffer 
		//sendBuffer should have a packetbuffer and a databuffer
		if(!this.sendBuffer.isBufferFull() && (this.dataBuffer.length > this.packet_size 
			|| (this.end && this.dataBuffer.length))) {	
			let nextData = this.dataBuffer.slice(0,this.packet_size)
			this.dataBuffer = this.dataBuffer.slice(this.packet_size)
			this.sendBuffer.insert(null, nextData)	
		}

		if(this.sendBuffer.hasNext() && !this.sendBuffer.isWindowFull())  {
			let next = this.sendBuffer.getNext() //next = {seq, elem, timer, timestamp}
			next.timeStamp = this.timeStamp()

			next.timer = setTimeout((function() {
				
				this.ssthresh = this.sendBuffer.maxWindowBytes / 2
				this.sendBuffer.changeWindowSize(this.packet_size); 

				process.stdout.write(" | Timeout: " + next.seq + " | default_timeout:  " + this.default_timeout)
				this.file.write((this.timeStamp()/1e3) + " " + this.sendBuffer.curWindow() + " " + this.sendBuffer.maxWindowBytes + " " + this.sendBuffer.ackNum() + "\n")
				this.file2.write(this.timeStamp()/1e3 + " " + this.sendBuffer.ackNum() + " " + "Timeout: " + next.seq % Math.pow(2,16) + " " + this.default_timeout + "\n" )

				this._sendData()
			}).bind(this) , this.default_timeout  / 1000)

			let header = this.makeHeader(ST_DATA, next.seq % Math.pow(2,16), this.recvWindow.ackNum())
			this.packetsInFlight++
			this._send(header, next.elem)
		}
	}

	if(this.dataBuffer.length == 0) this.emit('dataBuffer:empty')

}

Socket.prototype._sendState = function(seq_nr, ack_nr) { 

	this._send(this.makeHeader(ST_STATE, seq_nr, ack_nr ))

}

Socket.prototype._send = function(header, data) {

	if(data) this.uploadSpeed = speed3(data.length)
	let bufHeader = getBufHeader(header)
	let packet = data != undefined ? Buffer.concat([bufHeader, data]) : bufHeader
	this.udpSock.send(packet, this.port, this.host)

} 

Socket.prototype._handleDupAck = function (ackNum) {

	if(this.sendBuffer.isEmpty()) return
 
	if(ackNum != this.sendBuffer.ackNum()) { 
		this.dupAck = 0
		//Math.abs(this.dupAck - (ackNum - this.SendBuffer.ackNum()), 0)
	}

	else {
		this.dupAck++;
	}

	if(this.dupAck == 3 ) {
		process.stdout.write(" | Dup Ack: Expected " + (this.sendBuffer.ackNum() + 1) + " got " + ackNum + "    ")
		this.file2.write(this.timeStamp()/1e3 + " " + this.sendBuffer.ackNum() + " " + "DupAck" + "\n")

		//let size = this.sendBuffer.maxWindowBytes / 2
		//if(size < this.packet_size) size = this.packet_size
		this.ssthresh = this.sendBuffer.maxWindowBytes / 2
		this.sendBuffer.changeWindowSize(this.packet_size)
		this._sendData()
				
		//let seq = ackNum + 1
		//this._send(this.makeHeader(ST_DATA, seq, this.recvWindow.ackNum()), this.sendBuffer.get(seq))
	}

}

Socket.prototype._calcNewTimeout = function(timeStamps) {

	if(this.dupAck != 0) return 
	let time = this.timeStamp()
	timeStamps.map((x)=>{ return time - x}).forEach((function(packet_rtt) {
		let delta = this.rtt - packet_rtt
		this.rtt_var += (Math.abs(delta) - this.rtt_var)/4
		this.rtt += (packet_rtt - this.rtt) / 8
		this.deault_timeout = Math.max(this.rtt + this.rtt_var * 4, MIN_DEFAULT_TIMEOUT)
	}).bind(this))

}

Socket.prototype._updateWinReplyMicro = function(header) {

	let time = this.timeStamp()
	this.reply_micro = header.timestamp_difference_microseconds
	this.timestamp_difference_microseconds = Math.abs(Math.abs(time) - Math.abs(header.timestamp_microseconds) % Math.pow(2,32))
	this.win_reply_micro.insert(Math.abs(this.reply_micro),time/1e3)
	this.win_reply_micro.removeElemLess(time/1e3 - 120*1e3)

}

Socket.prototype._scaledGain = function(packetsAcked, bytes) {

	assert(packetsAcked >= 0)
	let base_delay = Math.abs(this.reply_micro - this.win_reply_micro.peekMinValue())
	let delay_factor = (CCONTROL_TARGET - base_delay) / CCONTROL_TARGET;
	//if(packetsAcked > )
	//bytes = Math.min(bytes, this.ssthresh)
	bytes = this.packet_size
	//bytes = this.packet_size
	//let windowFactor = ((packetsAcked * this.sendBuffer.packetSize) / this.sendBuffer.maxWindowBytes)
	let windowFactor = ((bytes) / this.sendBuffer.maxWindowBytes)
	//let windowFactor = (this.sendBuffer.curWindow() / this.sendBuffer.maxWindowBytes)
	
	if(this.sendBuffer.maxWindowBytes < this.ssthresh && delay_factor >= 0.5) {
		this.sendBuffer.maxWindowBytes += this.packet_size 
	} else if (delay_factor < 0.1) {
		this.ssthresh = this.sendBuffer.maxWindowBytes
	} else {
		this.sendBuffer.maxWindowBytes +=  MAX_CWND_INCREASE_PACKETS_PER_RTT * delay_factor * windowFactor
	}

	this.sendBuffer.maxWindowBytes = Math.max(this.packet_size, this.sendBuffer.maxWindowBytes)

}

Socket.prototype._recv = function(msg) { 

	header = getHeaderBuf(msg)
	this._updateWinReplyMicro(header)
	
	//sender   disconnected------>|connecting|------------>|      connected           s/r  disconnecting -------------> disconnected
	//                               s:syn      r:state        state/data/fin                  s:fin          r:fin
	//reciever         disconnected--------->| connecting |-------->|   connected     r/s |------------->    recvSyn -->disconnected
	//                               r:syn      s:state     r:data    state/data/fin           r:fin          s:fin
	//in one of disconnected, connecting, connected, disconnecting states
	//may recieve syn, state, data, fin or reset
	//not connected : accept syn, send reset for any other mesg. timeout if nothing
	//connecting : if initiator then accept state, if recv'er of syn then accept data or state?, send reset on fin, goto disconnected on timeout, disconnect on reset
	//connected : accept state, data, fin and reset. if mesg timeout (no keepalive or no acks) or reset go to disconnected
	
	//timer in connecting, connected and disconnected states
	//can be half open ??
	var reset = function() {
		this.connected = this.connecting = this.recvFin = this.end = false; this.eof_pkt = null
		self = this; clearTimeout(self.keepAlive); clearTimeout(self.synTimer)
	}
	if(header.type == ST_RESET) {
		return reset()
	} else if(header.type == ST_SYN) {  
		if(!this.connected)
			this._recvSyn(header) 
		return //trying to reconnect?
	} else if (this.connecting & !this.connected & header.type != ST_FIN) { //establish connection for both syn'er and recv syn'er
		this.connecting = false;
		this.connected = true;
		console.log('Connection established')
		if(header.type == ST_STATE) { //sender of syn only			
			this.sendBuffer.maxRecvWindowBytes = header.wnd_size
			this.recvWindow = new RecvWindow(header.seq_nr, -1, DEFAULT_RECV_WINDOW_SIZE, this.packet_size)	
			this.emit('connected')
			/*if() this.keepAlive = setInterval(()=> {
			this._sendState(this.sendBuffer.seqNum(), this.recvWindow.ackNum())
			}, KEEP_ALIVE_INTERVAL);*/
		}
	} else if (!this.connected && !this.connecting) { //maybe reset, fin, state or data
		this._send(this.makeHeader(ST_RESET, null, null))
		return // may be send reset ??
	} else if (header.type == ST_FIN) { //before connect/connecting or after?
		this.recvFin = true
		this.eof_pkt = header.seq_nr;
	} 

	this.sendBuffer.maxRecvWindowBytes = header.wnd_size

	let dupAck = this.dupAck
	this._handleDupAck(header.ack_nr)

	let [timeStamps, packsAcked, bytesAcked] = this.sendBuffer.removeUpto(header.ack_nr)

	this.file.write((this.timeStamp()/1e3) + " " + this.sendBuffer.curWindow() + " " + this.sendBuffer.maxWindowBytes + " " + this.sendBuffer.ackNum() + " " + this.rtt + "\n")

	if(dupAck == 0)
		this._calcNewTimeout(timeStamps) //updates rtt with timestamps of recv packs
	
	//outstandingPackets = outstandingPackets //- (dupAcks - this.dupAcks)
	if(dupAck == 0)
		this._scaledGain(packsAcked, bytesAcked) //arg is outstanding packets acknowledged
	
	this._sendData()

	if(header.type == ST_STATE) return; //nothing more to do	

	if(header.type == ST_DATA & this.recvWindow.ackNum() != this.eof_pkt) //no ST_DATA packs after recv fin and remaining data pkts
		this._recvData(header, msg.slice(20))

}
 
 Socket.prototype._recvData = function(header, data) {

 	//assert(this.recvWindow.ackNum() != this.eof_pkt)
 	//Must not insert seqs nums less then recvWindow's ackNum.
	//Since Acknum recvWindow > ackNum sendWindow and (assuming) send window is never larger then 300 packets (drpZn), worst case no ack has reached sender and send window
	//is max 300 pkt seqs nums behind recieve window. Reject all these seqs nums. Special case if ackNum is within 300 pkts of 0. Then nums close to 2^16 should also be rejected
	//smallest packet size 150 bytes, max send/recv buffers around 200 kB ~ 1200 packets - rare condition
	let drpZn = 300
	if (header.seq_nr <= this.recvWindow.ackNum() && header.seq_nr > this.recvWindow.ackNum() - drpZn && this.recvWindow.ackNum() >= drpZn 
	|| this.recvWindow.ackNum() < drpZn && header.seq_nr > Math.pow(2,16) - drpZn) return this._sendState(this.sendBuffer.seqNum() - 1, this.recvWindow.ackNum());
	
	this.recvWindow.insert(header.seq_nr, data) //assumes seqnum > acknum
	this.recvWindow.removeSequential().forEach((pack)=>{this.push(pack)}, this)
	
	if(this.recvFin & (this.recvWindow.ackNum() == this.eof_pkt)) {
		//end stream
		this.push(null)
		//finish emitted when end() called on writable
		//end emitted when push(null) called on readable
	}

	this._sendState(this.sendBuffer.seqNum() - 1, this.recvWindow.ackNum())

 }

Socket.prototype._final = function(callback) {

	this._end(callback)

}

Socket.prototype._end = function(callback) {

	this.end = true
	this._sendData() //dataBuffer empty	
	self = this
	this.once('dataBuffer:empty', self._sendFin)
	this.once('dataBuffer:empty', callback)
	//
	//this.sendWindow.isEmpty and this.recvFin==true 
	//kill socket
}

Socket.prototype._read = function() {}

Socket.prototype._writeable = function() {

	return this.connected & !this.eof_pkt

} 

Socket.prototype._write = function(data, encoding, callback) { //node does buffering

	if(!this.connected)
		this.once('connected', ()=>{this._write(data,encoding, callback)})

	this.dataBuffer = Buffer.concat([this.dataBuffer, data])
	callback()
	this._sendData()

}

function getHeaderBuf(buf) {

	return {
		'type' : buf.readUInt8(0) >> 4,
		'ver' : buf.readUInt8(0) & 0x0f,
		'extension' : buf.readUInt8(1),
		'connection_id' : buf.readUInt16BE(2),
		'timestamp_microseconds' : buf.readUInt32BE(4),
		'timestamp_difference_microseconds' : buf.readUInt32BE(8),
		'wnd_size' : buf.readUInt32BE(12),
		'seq_nr' : buf.readUInt16BE(16),
		'ack_nr' : buf.readUInt16BE(18)
	}

}

function getBufHeader(header) {

	let buf = Buffer.alloc(20)
	buf.writeUInt8(header.type << 4 | header.ver, 0)
	buf.writeUInt8(header.extension, 1)
	buf.writeUInt16BE(header.connection_id, 2)
	buf.writeUInt32BE(header.timestamp_microseconds, 4)
	buf.writeUInt32BE(header.timestamp_difference_microseconds, 8)
	buf.writeUInt32BE(header.wnd_size, 12)
	buf.writeUInt16BE(header.seq_nr, 16)
	buf.writeUInt16BE(header.ack_nr, 18)
	return buf

}

Socket.prototype.makeHeader = function(type, seq_nr, ack_nr) { //no side effects

	return {
		'type' : type,
		'ver' : VERSION,
		'connection_id' : type == ST_SYN ? this.recvConnectID : this.sendConnectID,
		'timestamp_microseconds' : this.timeStamp(),  
		'timestamp_difference_microseconds' : Math.abs(this.timestamp_difference_microseconds % Math.pow(2,32) ),
		'wnd_size' : DEFAULT_RECV_WINDOW_SIZE,
		'seq_nr' : seq_nr ? seq_nr : this.seq_nr,
		'ack_nr' : ack_nr ? ack_nr : this.ack_nr,
	}

}

uTP = {

	'Server' : Server,
	'Socket' : Socket,
	'createServer' : createServer,
	'createSocket' : createSocket

}

module.exports = uTP
