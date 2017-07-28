function Queue() {
	this.queue = []
	this.minIndex;
	this.endIndex;
	this.bytes;
	this.maxBytes;
}

Queue.prototype.put = function(index, elem) {
	let bytes = elem.length
	if(bytes > this.maxBytes - this.bytes) 
		throw new Exception("Full packet buffer")
	
	let index = index - this.startSeq
	this.maxSeq++;
	this.buffer[index] = elem
	this.bytes += bytes
	return this
}

Queue.prototype.get = function(index) {
	let index = index - this.startSeq;
	if(index > this.buffer.length)
		return undefined
	return this.buffer[index]
}

Queue.prototype.insert = function(index, elem) {
	for(var i = 0; i < this.queue.length; i++) {
		if(index < this.queue[i].index) {
			this.queue.splice(i, 0, {'index': index, 'elem':elem})
			return this
		}
	}
	this.queue.push({'index': index, 'elem':elem})
	
	return this
}

Queue.prototype.removeByElem = function(elem) {
	for(var i = 0; i < this.queue.length; i++) {
		if(elem == this.queue[i].elem)
			this.queue = this.queue.slice(i,1)
			return true
	}
	return false
}

Queue.prototype.removeUptoElem = function(elem) {
	var i = 0
	for(; i < this.queue.length; i++) {
		if(this.queue[i].elem <= elem)
			this.queue.splice(i, 1)
	}
	return i
}

Queue.prototype.popMinIndex = function() {
	return this.queue.shift()
}

Queue.prototype.peekMinIndex = function() {
	return this.queue[0]
}

Queue.prototype.empty = function() {
	this.queue = []
	return this
}

Queue.prototype.isEmpty =  function() {
	return this.queue.length == 0
}

Queue.prototype.removeSeqIndices = function(upto) {
	//let remove = []
	if(upto && upto < this.minIndex) return []
	let elems = []
	var i = 0
	//console.log("recieved acks for upto", upto)
	for(; i < this.queue.length; i++) {
		
		//if(!this.remove(this.startSeq + i))
		if(upto && upto < this.minIndex + i) break 
		if(!this.queue[i]) break
		//console.log("removing", this.startSeq + i)
		let elem = this.queue[i].elem
		let bytes = elem.length
		this.bytes -= bytes
		elems.push(this.queue.shift())
	}
	this.startSeq += i 
	return packs
}

module.exports = Queue