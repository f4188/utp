
dgram = require('dgram')
Duplex = require('stream').Duplex
crypto = require('crypto')
util = require('util')
EventEmitter = require('events').EventEmitter
TQueue = require('./lib/tqueue.js')
speedometer = require('speedometer')
PacketBuffer = require('./lib/PacketBuffer.js')

var speed = speedometer(1)

const ST_DATA = 0  //Data
const ST_FIN = 1
const ST_STATE = 2 //Ack
const ST_RESET = 3  
const ST_SYN  = 4

const VERSION = 1

const INITIAL_TIMEOUT = 5000
const CCONTROL_TARGET = 100000
const MAX_CWND_INCREASE_PACKETS_PER_RTT = 8
const DEFAULT_WINDOW_SIZE = 10 * 1500
const KEEP_ALIVE_INTERVAL = 60000

function createServer() {
	return new Server()
}

function Server() {
	EventEmitter.call(this)
	this.udpSock;
	this.conSockets = {};
	this.cheat;
}

util.inherits(Server, EventEmitter)

Server.prototype.listen = function(port, connectListener) { //call once
	this.udpSock = dgram.createSocket('udp4');
	this.udpSock.bind(port);
	
	this.udpSock.on('message', (msg, rinfo) => {
		var header = getHeaderBuf(msg)
		var id = rinfo.address + ":" + rinfo.port + "#" + ((header.type != ST_SYN) ? header.connection_id : (header.connection_id + 1));
		//console.log('Server: packet from', id)
		//console.log('Header')
		//console.log(header)
		//console.log("id::",id)
		if(this.conSockets[id]) {
			this.conSockets[id]._recv(msg);
			return
		} 
		
		if(header.type != ST_SYN) return
		//console.log("New connection")
		//c_id = (header.connection_id + 1)
		//id = rinfo.address + ":" + rinfo.port + "#" + c_id;
		this.conSockets[id] = new Socket(this.udpSock, rinfo.port, rinfo.address)
		this.cheat = this.conSockets[id]
		this.conSockets[id].on('closed', ()=> delete this.conSockets[id])	
		this.conSockets[id].on('data', (data) => {var bs = speed(data.length); this.total += data.length; console.log("BYTES PER SECOND:",bs )})
		this.emit('connection',this.conSockets[id])
		this.conSockets[id]._recv(msg)	
	})
}

Server.prototype.close = function() {
	
}

function createSocket() {
	return new Socket(dgram.createSocket('udp4'))
}

function Socket(udpSock, port, host) {
	Duplex.call(this)
	
	this.port = port;
	this.host = host;
	
	this.total = 0;
	this.dataBuffer = Buffer.alloc(0)
	this.sendBuffer = []
	this.sendBufferInit = null
	this.recvBuffer = []
	this.recvBuffer2 = new PacketBuffer()
	this.timer;
	
	this.udpSock = udpSock;

	this.connected = false;
	this.connecting = false;
	
	this.dupAck = 0;
	
	this.packet_size = 1500
	this.numPacks = 0; //number of packets sent
	this.cur_window = 0; //bytes sent, not acked
	
	this.max_window = DEFAULT_WINDOW_SIZE ; //max send window 
	this.wnd_size = DEFAULT_WINDOW_SIZE * 10; //max recieve window
	this.ownWnd_size = DEFAULT_WINDOW_SIZE * 10;
	
	this.reply_micro = 250*1000;
	
	this.default_timeout =  INITIAL_TIMEOUT
	this.timeOutMult = 1
	this.rtt = 500;
	this.rtt_var = 100;
	
	this.seq_nr;
	this.ack_nr;
	this.eof_pkt = null;
	
	this.sendConnectID; 
	this.recvConnectID; 
	
	this.timeOutQueue = new TQueue() 
	this.timeStamp = timeStampF
	this.win_reply_micro = []//[{time:this.timeStamp()/1e3,'reply_micro': 1000}]
	this.win_reply_micro2 = new TQueue()
	//this.win_reply_micro2.insert(this.timeStamp()/1e3, 1000)
	this.acks = []
	this.seqs = []
}

util.inherits(Socket, Duplex)

Socket.prototype.remoteAddress = function () { return {'port' : this.port, 'host' : this.host} }

Socket.prototype.connect = function (port, host) {
	this.port = port;
	this.host = host;
	
	/*
	this.keepAlive = setInterval(()=> {
		console.log('keep alive')
		this._sendState()
	}, KEEP_ALIVE_INTERVAL);
	*/
	this.udpSock.on('message', (msg, rinfo) => {
		
		//console.log("Socket: recieved packet")
		//console.log("Header")
		//console.log(getHeaderBuf(msg))
		if(getHeaderBuf(msg).connection_id == this.recvConnectID) {
			//console.log('RECIEVING MESSAGE')
			this._recv(msg);
		}
	})
	
	this.connecting = true;
	this._sendSyn()
	
}

Socket.prototype._sendSyn = function() { //called by connect
	this.seq_nr = crypto.randomBytes(2).readUInt16BE();
	this.sendBufferInit = this.seq_nr
	this.recvConnectID = crypto.randomBytes(2).readUInt16BE();
	this.sendConnectID = this.recvConnectID + 1;
	let header = this.makeHeader(ST_SYN)
	
	//this.timeOutQueue.insert(header.timestamp_microseconds, this.seq_nr)
	/*this.timer = setTimeout(()=> {
		this.timeOutMult *= 2;
		this._send(header)
	}, this.timeOutMult * this.default_timeout) //resend syn
	*/
	this._send(header);
	this.seq_nr++;
} 

Socket.prototype._recvSyn = function(header) {
	this.sendConnectID = header.connection_id;
	this.recvConnectID = header.connection_id + 1;
	this.ack_nr = header.seq_nr;
	this.recvBuffer2.init(header.seq_nr + 1)
	this.seq_nr = crypto.randomBytes(2).readUInt16BE()
	this.sendBufferInit = this.seq_nr
	this.wnd_size = header.wnd_size;
	this.connecting = true;
	this._sendState() //synack
	this.seq_nr ++;
	
}

Socket.prototype._sendFin = function() {
	//this.emit('dump')
	this._send(this.makeHeader(ST_FIN))
}

Socket.prototype._resendData = function() { //resend packeet at beginning of window
	this._sendData()
}

Socket.prototype._sendData = function() { //called by write, calls_send
	
	while(this.cur_window + this.packet_size < this.max_window && this.cur_window < this.wnd_size && this.sendBuffer.length > 0 ) {
		let index = this.seq_nr - this.sendBufferInit
		if(index > this.sendBuffer.length) break;
		let next_data = this.sendBuffer[index]
		//console.log("NextDATA", next_data)
		let header = this.makeHeader(ST_DATA)
		this.timeOutQueue.insert(header.timestamp_microseconds, this.seq_nr)
		this.seqs.push(this.seq_nr)
		this.numPacks++;
		this.seq_nr++;
		if(next_data != undefined)
			this.cur_window += next_data.length
		this._send(header, next_data)
	}
}

Socket.prototype._sendState = function(ack_nr) { //called by _recvSyn, _keepAlice, calls _send
	this.acks.push(this.ack_nr)
	this._send(this.makeHeader(ST_STATE, null, ack_nr ))
}

Socket.prototype._send = function(header, data) { //called by _send functions
	let bufHeader = getBufHeader(header)
	let packet = data != undefined ? Buffer.concat([bufHeader, data]): bufHeader
	this.udpSock.send(packet, this.port, this.host)
} 

Socket.prototype._handleDupAck = function (header) {
	
	if(this.numPacks == 0) return
	//if(header.type == ST_DATA) return
	
	if(header.ack_nr == this.seq_nr - this.numPacks - 1) { //oldests acked packet
		//console.log("dupack!!")
		this.dupAck++;
	} else {
		this.dupAck = 0;
	}
	if(this.dupAck == 3) {
		
		this.dupAck = 0;
		this.max_window = this.max_window > 1 ? parseInt(this.max_window / 2) : 1
	
		this.seq_nr = this.seq_nr - this.numPacks
		this.cur_window = 0
		this.numPacks = 0

		this._resendData()	
	}
}

Socket.prototype._calcTimeout = function(header) {
	if(this.dupAck != 0) return 
	let packet_rtt = Math.abs(this.timeStamp()) - Math.abs(header.timestamp_microseconds);
	let delta = this.rtt - packet_rtt
	this.rtt_var += (Math.abs(delta) - this.rtt_var)/4
	this.rtt += (packet_rtt - this.rtt) / 8
	this.default_timeout = Math.max(Math.abs(this.rtt + this.rtt_var * 4), 500000)
}

Socket.prototype._changeWindowSizes = function(header) {
	//mutates max send and recieve window sizes
	this.wnd_size = header.wnd_size;
	
	this._calcTimeout(header)

	//use base delay
	let time = this.timeStamp()
	
	this.win_reply_micro2.insert(this.reply_micro, time/1e3)
	
	while(!this.win_reply_micro2.isEmpty() && this.win_reply_micro2.peekMinTime().elem < (time/1e3-2*60*1e3) ) {		
		this.win_reply_micro2.popMinTime()
	}
	
	if(this.win_reply_micro2.isEmpty())return
	var min =  this.win_reply_micro2.peekMinTime().time 	
	let base_delay = min
	let off_target =  CCONTROL_TARGET - base_delay ;
	let delay_factor = off_target / CCONTROL_TARGET;
	let window_factor = this.cur_window / this.max_window;
	let scaled_gain = MAX_CWND_INCREASE_PACKETS_PER_RTT * delay_factor * window_factor;
	
	this.max_window += scaled_gain;
	if(!(this.max_window > 0)) this.max_window = 1
}

Socket.prototype._recv = function(msg) { //called by listener, handle ack in all cases
	header = getHeaderBuf(msg)
	//console.log('recieved', header)
	clearTimeout(this.timer)
	this.timeOutMult = 1;
	this.reply_micro = Math.abs(this.timeStamp()) - Math.abs(header.timestamp_microseconds)
	
	if(header.type == ST_SYN) { //handle spurious syn and first syn
		if(!this.connected)
			this._recvSyn(header)
		return; 
	} else if (this.connecting & !this.connected) {
		this.connecting = false;
		this.connected = true;
		if(header.type == ST_STATE) { //sender of syn only
			console.log('Finish connection est')
			this.timeOutQueue.removeByElem(this.seq_nr)
			this.ack_nr = header.seq_nr	
			this.recvBuffer2.init(header.seq_nr + 1)
			this.emit('connected')
		} //else if(header.type == ST_DATA)
	} else if (header.type == ST_FIN) {
		console.log('ST_FIN')
		if(!this.connected)
			this._close()
		this.eof_pkt = header.seq_nr;
	} else if (header.type == ST_RESET) {
		console.log("ST_RESET")
		this._close()
		return;
	}
	//console.log("handle data or state")
	this._handleDupAck(header);
	
	this._changeWindowSizes(header); //must come before cur_window is decremented
	
	for(var i = this.seq_nr - this.numPacks ; i <= header.ack_nr; i++) {
		this.timeOutQueue.removeByElem(i)
		let ackedData = this.sendBuffer.shift()
		this.sendBufferInit++;
		this.numPacks--;
		this.cur_window -= ackedData.length
		if(i > this.seq_nr) 
			this.seq_nr++;
	}
	//either state or data type. in either case handle ack
	if(!this.eof_pkt) 
		this._sendData()
	
	if(this.numPacks > 0){
	let elap = (this.timeStamp() - this.timeOutQueue.peekMinTime().time)/1e3

	this.timer = setTimeout(()=> {
		console.log("TIMEOUT")
		this.seq_nr = this.seq_nr - this.numPacks;
		this.numPacks = 0;
		this.timeOutQueue.empty()
		this.packet_size = 1500
		this.max_window = 1
		this.timeOutMult = 2;
		this._resendData()
	}, this.timeOutMult * (this.default_timeout - elap )) //
	}
	
	if(header.type == ST_STATE) return; //nothing more to do
	
	if(header.type == ST_DATA)
		this._recvData(header, msg.slice(20))
}
 
 Socket.prototype._recvData = function(header, data) {
	
	if(header.seq_nr > this.ack_nr + this.ownWnd_size)
		return
	else if (this.ack_nr && (header.seq_nr <= this.ack_nr)) { //already acked
		this._sendState(header.seq_nr)
		return;
	}
	
	this.recvBuffer2.put(header.seq_nr, data)
	/*
	var i = 0 //insert in recieve window buffer
	for(; i < this.recvBuffer.length; i++) { //reverse ##
		if(header.seq_nr == this.recvBuffer[i].seq_nr) //duplicate data
			break;
		else if(header.seq_nr < this.recvBuffer[i].seq_nr) {
			this.recvBuffer.splice(i,0,{'seq_nr' : header.seq_nr , 'data' : data})
			//this.recvBuffer[] = data
			break;
		} 
	}
	
	if(i == this.recvBuffer.length)
		this.recvBuffer.push({'seq_nr' : header.seq_nr , 'data' : data})
	*/
	this.recvBuffer2.removeSeqs().forEach((packs)=> {this.push(packs), this.ack_nr++})
	
	//packs.forEach((packs)=>this.push(packs) )
	/*
	for(var i = 0; i < this.recvBuffer.length; i++) { //remove contiguous packs 
		let next_ack = this.ack_nr + 1
		if(next_ack == this.recvBuffer[i].seq_nr) {
			//console.log("have", next_ack)
			this.push(this.recvBuffer.shift().data)
			this.ack_nr = next_ack
		} else 
			break;
	}*/
	
	if(this.eof_pkt & (this.ack_nr == this.eof_pkt)) {
		if(this.connected) {
			this._sendFin()
			this.connected = false;
		}
		this._close() //final shutdown
		return
	}
	//console.log('send ack')
	this._sendState();
 }
 
Socket.prototype._close = function() { //fin exchanged
	console.log('closed')
	this.emit('closed')
	this.udpSock.close()
}
 
Socket.prototype.close = function() { //send fin, wait for fin reply
	this._sendFin()
	//this.emit('dump', 'fin')
}
/*
Socket.prototype._final = function() {
	this.emit('dump')
	console.log("final")
	
}*/

Socket.prototype._read = function() {}

Socket.prototype._writeable = function() {
	return this.connected & !this.eof_pkt;
} //bool

Socket.prototype._write = function(data, encoding, callback) { //node does buffering
	if(!this._writeable()) {
		//console.log('sending', data.toString())
		this.once('connected', ()=>{this._write( data,encoding, callback)})
		return
	}

	while(this._writeable() && data.length > 0)  {
		this.sendBuffer.push(data.slice(0,this.packet_size))
		data = data.slice(this.packet_size)
	}
	this._sendData()	
	return callback()	
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
		'timestamp_difference_microseconds' : this.reply_micro,
		'wnd_size' : this.ownWnd_size,
		'seq_nr' : seq_nr ? seq_nr : this.seq_nr,
		'ack_nr' : ack_nr ? ack_nr : this.ack_nr,
	}
}

var timeStampF = function () {
	let now = process.hrtime()
	return (now[0] * 1e6 + Math.floor(now[1]/1e3)) % Math.pow(2,32)
}

uTP = {
	'Server' : Server,
	'Socket' : Socket,
	'createServer' : createServer,
	'createSocket' : createSocket
}

module.exports = uTP
