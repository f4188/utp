
//window new, all values null 
//window new, with start, all other values null 
// _ _ _ _ _ _
//window with packets , startseq, afterEndSeq, numPackets, windowWidth integers
//if at least one element then
//startSeq = seq of first pack, afterEndSeq = seq of last packet + 1, numPacket = number of packets <= windowWidth, 
//window width = afterEndSeq - startseq 
//afterEndSeq-startseq % Math.pow(2,16) = length % Math.pow(2,16)
// if length > Math.pow(2,16) overwrite, throw exception
// 1 _ _ 3 _ _ _ 4 or _ _ 3 _ _ _5 7
//if zero elems i.e. window empty but not new (packets added and removed)
//numpackets = 0, windowwidth = 0, afterEndSeq == startSeq
// _ _ _ _ _ _ _ _ _
function WindowBuffer (start, maxWindowBytes, packetSize) {
	this.buffer = []
	this.startSeq = start; //smallest seq
	this.seq_nr = null
	this.afterEndSeq = start
	this.windowWidth = 0
	this.numPackets = 0
	this.bytes = 0
	this.maxWindowBytes = maxWindowBytes;
	this.maxRecvWindowBytes
	this.packetSize = packetSize

	
	this.packetCapacity = Math.pow(2, 16)
	//initially startseq = maxSeq = null
	//

	if(start) {
		this.startSeq = start

	}
}

WindowBuffer.prototype.halveWindowSize = function() {

}

WindowBuffer.prototype.curWindow = function () {
	return this.bytes
}

WindowBuffer.prototype.seqNum = function() {
	return this.afterEndSeq
}

WindowBuffer.prototype.ackNum = function() {
	return this.startSeq - 1;
}

WindowBuffer.prototype.numPackets = function() {
	return this.numPackets
}

WindowBuffer.prototype.maxWindow = function() {
	return this.maxWindowBytes
}

WindowBuffer.prototype.isEmpty = function() {
	//assert(this.numPackets != this.buffer.length, "numPackets != buffer.length")
	return this.numPackets == 0
}

WindowBuffer.prototype.isFull = function() {
	return this.bytes > (this.maxWindowBytes - this.packetSize) &&  this.bytes > (this.maxRecvWindowBytes - this.packetSize) 
}

//if put(seq_1) then put(seq_2) and seq_1 < seq_2 then constructor called with start
WindowBuffer.prototype.put = function(seq, elem) {

	if(seq == null) 
		seq = this.afterEndSeq
	
	let index = seq - this.startSeq

	if(index >= this.packetCapacity)
		throw new Exception("seq num wrap")

	this.buffer[index] = elem

	let bytes = elem.length
	this.bytes += bytes

	this.numPackets++;
		
	if(seq >= this.afterEndSeq) {
		this.afterEndSeq = seq + 1
		this.windowWidth = seq - this.startSeq + 1
	}

	return seq
}

WindowBuffer.prototype.get = function(seq) {
	//assert(seq < this.afterEndSeq && seq >= this.startSeq, "remove: outside window")
	let index = seq - this.startSeq;
	//if(index > this.buffer.length)
	//	return undefined
	return this.buffer[index]
}

//for sendwindow seq and upto in remove(seq) or removeSeqs(upto) calls never greater than end of window seq
//since header.ack_nr < seq_nr or header.ack_nr <= seq of end packet and seq or upto = header.ack_nr
//for recvwindow only sequential packets removed from beginning
WindowBuffer.prototype.remove = function(seq) {
	//assert(seq < this.afterEndSeq && seq >= this.startSeq, "remove: outside window")
	let index = seq - this.startSeq 
	//if(index > this.buffer.length) return false
	
	let elem = this.buffer[index]
	if(this.buffer[index]) {
		this.bytes -= elem.length
		this.numPackets--;
		this.buffer[index] = undefined
		if(this.numPackets == 0) { //only 1 elem left. set afterEndSeq == startSeq
			this.windowWidth--;
			this.afterEndSeq = this.startSeq
			return true
		}
		while(this.buffer[this.afterEndSeq - this.startSeq - 1] == undefined) { 
			this.buffer.pop()
			this.afterEndSeq--;
			this.windowWidth--;
		}
		return true
	}
	return false
		
}

//remove elements with contiguous sequence numbers from beginning to upto or until missing elem
WindowBuffer.prototype.removeSeqs = function(upto) {
	//let remove = [] = 
	if(upto && upto < this.startSeq) return []
	let packs = []
	var i = 0
	//console.log("recieved acks for upto", upto)
	for(; i < this.windowWidth; i++) {
		
		//if(!this.remove(this.startSeq + i))
		if(this.buffer[i] == undefined) break
		if(upto < this.startSeq + i) break 
		
		//console.log("removing", this.startSeq + i)
		let elem = this.buffer[i]
		let bytes = elem.length
		this.bytes -= bytes
		packs.push(elem)
		//callback(elem)


		//packs.push(this.buffer.shift())
	}
	this.startSeq += i
	this.numPackets -= i 
	this.windowWidth -= i
	while(i != 0) {
		//console.log("garbage")
		this.buffer.shift()
		//this.buffer.shift()
		i--
	}
	return packs
	//when buffer empty, startSeq = maxSeq + 1
}



module.exports = WindowBuffer